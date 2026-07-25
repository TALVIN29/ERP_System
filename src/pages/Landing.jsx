import { useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  LandingHeader,
  Hero,
  StatBand,
  FeatureRow,
  ScreenshotFrame,
  FomoBand,
  LandingFooter,
} from '../components/landing.jsx';

gsap.registerPlugin(ScrollTrigger);

export default function Landing() {
  useEffect(() => {
    return () => {
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    };
  }, []);

  return (
    <div className="bg-[var(--surface-page)] text-[var(--text-primary)]">
      <LandingHeader />
      <Hero />
      <StatBand />
      <FeatureRow
        image="https://images.unsplash.com/photo-qN7QYbKaW_w?auto=format&fit=crop&w=1600&q=70"
        title="Insight, not just charts"
        description="Every finding carries a recommended action. See the data, understand what to fix, act immediately."
        imagePosition="left"
      />
      <FeatureRow
        image="https://images.unsplash.com/photo-7YVf6kGWwrw?auto=format&fit=crop&w=1600&q=70"
        title="Permissions you can see"
        description="Role-based access control is real. Build complex permission matrices and see them take effect instantly."
        imagePosition="right"
      />
      <FeatureRow
        image="https://images.unsplash.com/photo-RyC0LfVrJQo?auto=format&fit=crop&w=1600&q=70"
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
