import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, DEMO_CHIPS } from '../lib/auth.jsx';
import { Button, TextField, InlineError } from '../components/ui.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const submitRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      navigate(location.state?.from || '/app/dashboard');
    } catch (err) {
      if (err.message?.includes('Email not confirmed')) {
        setError('Please confirm your email first');
      } else if (err.message?.includes('Invalid login credentials')) {
        setError('Email or password is incorrect');
      } else if (err.message?.includes('Too many attempts')) {
        setError('Too many attempts, try again in 60s');
      } else {
        setError(err.message || 'Sign in failed');
      }
      setLoading(false);
    }
  };

  const handleDemoChip = (chip) => {
    setEmail(chip.email);
    setPassword(chip.password);
    setError('');
    setTimeout(() => submitRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (session) {
      navigate(location.state?.from || '/app/dashboard');
    }
  }, [session, navigate, location]);

  return (
    <div className="flex h-screen bg-[var(--surface-page)]">
      {/* Photo panel - hidden below 768px */}
      <div className="hidden md:flex flex-1 bg-black/80 relative overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-4oK8VEfPgGk?auto=format&fit=crop&w=800&q=70"
          alt="Warehouse inventory"
          className="absolute inset-0 w-full h-full object-cover opacity-60"
          loading="eager"
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 to-black/80" />
        <div className="relative flex items-center justify-center p-8">
          <blockquote className="text-[28px] font-semibold text-white text-center leading-tight">
            Above 20% discount every order loses money.
          </blockquote>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-[32px] font-semibold text-[var(--text-primary)] mb-6">Sign in</h1>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              disabled={loading}
              error={error ? '' : undefined}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              disabled={loading}
              error={error ? '' : undefined}
            />
            <Button
              ref={submitRef}
              variant="primary"
              type="submit"
              loading={loading}
              disabled={loading}
              className="mt-2"
            >
              Sign in
            </Button>
            {error && <InlineError>{error}</InlineError>}
          </form>

          <div className="my-6 border-t border-[var(--border-hairline)]" />

          <p className="text-[12px] text-[var(--text-secondary)] mb-3">— or try a demo role —</p>
          <div className="grid grid-cols-2 gap-2 mb-6">
            {DEMO_CHIPS.map((chip) => (
              <button
                key={chip.label}
                onClick={() => handleDemoChip(chip)}
                disabled={loading}
                className="px-3 py-2 rounded-[var(--radius-md)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <div>{chip.label}</div>
                <div className="text-[10px] text-[var(--text-secondary)]">{chip.scope}</div>
              </button>
            ))}
          </div>

          <p className="text-[13px] text-[var(--text-secondary)] text-center">
            No account?{' '}
            <button
              onClick={() => navigate('/signup')}
              className="text-[var(--series-1)] hover:underline"
            >
              Sign up
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
