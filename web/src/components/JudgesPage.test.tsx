import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JudgesPage } from './JudgesPage';

describe('JudgesPage', () => {
  const html = renderToString(<JudgesPage />);

  it('renders every section', () => {
    for (const heading of ['Problem', 'See it work, no camera needed', 'What the physical therapist sees', 'How it works', 'Prize tracks', 'Privacy and honest notes', 'Team']) {
      expect(html).toContain(heading);
    }
  });

  it('links to the live session and hides links that are not filled in yet', () => {
    expect(html).toContain('href="/"');
    for (const track of ['Gemini', 'Tiger Data', 'Auth0', 'GoDaddy', 'Hardware']) expect(html).toContain(track);
    expect(html).not.toContain('Source code');
  });
});
