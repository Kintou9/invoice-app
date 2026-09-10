import { render, screen } from '@testing-library/react';
import App from './App';

// Replaces the default CRA "learn react" assertion, which stopped matching
// anything once the app was customized away from the starter template —
// this now checks real content from the actual landing page (the
// unauthenticated "/" route App renders by default in a test environment).
test('renders the landing page for an unauthenticated visitor', () => {
  render(<App />);
  const heroButton = screen.getAllByRole('button', { name: /start free/i })[0];
  expect(heroButton).toBeInTheDocument();
});
