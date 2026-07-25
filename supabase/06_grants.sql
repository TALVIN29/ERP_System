-- Transactional save for the permission matrix.
--
-- PUT /api/admin-roles used to DELETE a role's grants and then INSERT the
-- replacement set as two separate round trips. When the insert failed the
-- delete had already committed, so the role was left holding nothing — and
-- because that included Admin, every user in the system got 403 on every
-- endpoint. This is not hypothetical: it happened, and it took all 73 grants
-- with it.
--
-- A plpgsql function is one transaction. Any failure — including the lockout
-- check below — rolls the whole thing back and the matrix is untouched.

-- SECURITY DEFINER, deliberately: role_permissions has a delete policy but no
-- INSERT policy, so the old code's delete succeeded and its insert was refused
-- by RLS — which is exactly how the table ended up empty. Bypassing RLS here
-- means the permission check has to be made explicitly, first, below.
create or replace function save_role_grants(p_grants jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_key text;
  v_perms jsonb;
  v_role_id int;
  v_keeps_admin boolean := false;
begin
  -- Never rely on the caller having been gated upstream.
  if not has_perm('roles', 'update') then
    raise exception 'You do not have permission to edit permissions'
      using errcode = '42501';
  end if;

  if p_grants is null or jsonb_typeof(p_grants) <> 'object' then
    raise exception 'grants must be an object of role_key -> permission list'
      using errcode = '22023';
  end if;

  -- Lockout guard, evaluated against the RESULTING state, not just the payload.
  -- The client sends full state per CHANGED role, so editing only Viewer sends
  -- only Viewer — and checking the payload alone would reject that as a lockout
  -- even though Admin still holds roles.update untouched.
  select exists (
    select 1
    from roles r
    where case
      when p_grants ? r.key
        then (p_grants -> r.key) ? 'roles.update'
      else exists (
        select 1 from role_permissions rp
        join permissions p on p.id = rp.permission_id
        where rp.role_id = r.id and p.module = 'roles' and p.action = 'update'
      )
    end
  ) into v_keeps_admin;

  if not v_keeps_admin then
    -- Mapped to HTTP 409 by the API. Raising here also aborts the transaction,
    -- so no partial delete can survive.
    raise exception 'At least one role must keep permission to edit permissions'
      using errcode = 'P0001';
  end if;

  -- Only the roles named in the payload are touched; a role the admin did not
  -- edit keeps whatever it had.
  for v_role_key, v_perms in select * from jsonb_each(p_grants) loop
    select id into v_role_id from roles where key = v_role_key;
    if v_role_id is null then
      raise exception 'Unknown role: %', v_role_key using errcode = '22023';
    end if;

    delete from role_permissions where role_id = v_role_id;

    insert into role_permissions (role_id, permission_id)
    select v_role_id, p.id
    from permissions p
    where (p.module || '.' || p.action) in (
      select jsonb_array_elements_text(v_perms)
    )
    on conflict do nothing;
  end loop;

  -- Return the state the server actually holds, so the grid re-renders from
  -- this rather than from its own optimistic copy.
  return (
    select coalesce(jsonb_object_agg(r.key, coalesce(g.perms, '[]'::jsonb)), '{}'::jsonb)
    from roles r
    left join (
      select rp.role_id, jsonb_agg(p.module || '.' || p.action order by p.module, p.action) as perms
      from role_permissions rp
      join permissions p on p.id = rp.permission_id
      group by rp.role_id
    ) g on g.role_id = r.id
  );
end;
$$;

-- Reading the whole matrix, in the same shape the save returns.
create or replace function get_role_grants()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_object_agg(r.key, coalesce(g.perms, '[]'::jsonb)), '{}'::jsonb)
  from roles r
  left join (
    select rp.role_id, jsonb_agg(p.module || '.' || p.action order by p.module, p.action) as perms
    from role_permissions rp
    join permissions p on p.id = rp.permission_id
    group by rp.role_id
  ) g on g.role_id = r.id;
$$;
