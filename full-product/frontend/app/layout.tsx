import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'AEGIS · Security workspace',
  description:
    'An integrated defensive security workspace with explicit evidence, human review, and local model operations.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
