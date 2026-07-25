import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Button, TextField, InlineError } from '../components/ui.jsx';

const getPasswordStrength = (password) => {
  if (!password) return { score: 0, label: '', color: '' };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  const levels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
  const colors = ['', 'var(--status-critical)', 'var(--status-serious)', 'var(--status-warning)', 'var(--status-good)', 'var(--status-good)'];
  return { score, label: levels[score], color: colors[score] };
};

export default function Signup() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { signUp, session } = useAuth();
  const navigate = useNavigate();

  const strength = getPasswordStrength(password);
  const isPasswordValid = strength.score >= 3;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!fullName || !email || !password) {
      setError('All fields are required');
      return;
    }
    if (!isPasswordValid) {
      setError('Password must be stronger');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await signUp(email, password, fullName);
      setSubmitted(true);
    } catch (err) {
      if (err.message?.includes('already registered')) {
        setSubmitted(true);
      } else {
        setError(err.message || 'Sign up failed');
      }
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSubmitted(false);
    setFullName('');
    setEmail('');
    setPassword('');
    setError('');
  };

  useEffect(() => {
    if (session) {
      navigate('/app/dashboard');
    }
  }, [session, navigate]);

  if (submitted) {
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
        </div>

        {/* Success panel */}
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--status-good)]/10 mb-4">
              <span className="text-[24px] text-[var(--status-good)]">✓</span>
            </div>
            <h1 className="text-[32px] font-semibold text-[var(--text-primary)] mb-2">Check your email</h1>
            <p className="text-[15px] text-[var(--text-secondary)] mb-6">
              We've sent a confirmation link to <br />
              <span className="font-medium text-[var(--text-primary)]">{email}</span>
            </p>
            <p className="text-[13px] text-[var(--text-secondary)] mb-6">
              Click the link to confirm your account. You will not be signed in yet.
            </p>
            <button
              onClick={handleReset}
              className="text-[13px] text-[var(--series-1)] hover:underline"
            >
              Wrong address? Edit it
            </button>
          </div>
        </div>
      </div>
    );
  }

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
          <h1 className="text-[32px] font-semibold text-[var(--text-primary)] mb-6">Sign up</h1>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TextField
              label="Full name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                setError('');
              }}
              disabled={loading}
            />
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
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-[12px] font-medium text-[var(--text-secondary)]">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                disabled={loading}
                className="h-9 w-full px-3 rounded-[var(--radius-md)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] disabled:opacity-60"
              />
              {password && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded bg-[var(--surface-sunken)] overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${(strength.score / 6) * 100}%`,
                        backgroundColor: strength.color,
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-medium" style={{ color: strength.color }}>
                    {strength.label}
                  </span>
                </div>
              )}
            </div>

            <Button
              variant="primary"
              type="submit"
              loading={loading}
              disabled={loading || !isPasswordValid}
              className="mt-2"
            >
              Create account
            </Button>
            {error && <InlineError>{error}</InlineError>}
          </form>

          <p className="text-[13px] text-[var(--text-secondary)] text-center mt-6">
            Already have an account?{' '}
            <button
              onClick={() => navigate('/login')}
              className="text-[var(--series-1)] hover:underline"
            >
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
