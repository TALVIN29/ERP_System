import {
  LandingHeader,
  Hero,
  StatBand,
  FeatureRow,
  ScreenshotFrame,
  FomoBand,
  LandingFooter,
} from '../components/landing.jsx';

// Each section kills the one ScrollTrigger it created. A page-level
// getAll().kill() would also kill a sibling's trigger mid-StrictMode remount.
export default function Landing() {
  return (
    <div className="bg-[var(--surface-page)] text-[var(--text-primary)]">
      <LandingHeader />
      <Hero />
      <StatBand />
      <FeatureRow
        image="https://images.unsplash.com/photo-1587293852726-70cdb56c2866?auto=format&fit=crop&w=1600&q=70"
        title="Insight, not just charts"
        description="Every finding carries a recommended action. See the data, understand what to fix, act immediately."
        imagePosition="left"
      />
      <FeatureRow
        image="https://images.unsplash.com/photo-1586528116493-a029325540fa?auto=format&fit=crop&w=1600&q=70"
        title="Permissions you can see"
        description="Role-based access control is real. Build complex permission matrices and see them take effect instantly."
        imagePosition="right"
      />
      <FeatureRow
        image="https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=1600&q=70"
        title="No duplicate records, ever"
        description="Idempotent APIs ensure data integrity. Run the same request twice; one row is created."
        imagePosition="left"
      />
      <ScreenshotFrame />
      <FomoBand />
      <LandingFooter />
    </div>
  );
}
