import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Flux — Plataforma de Sales Engagement',
  description: 'Demonstração da plataforma Flux para equipes de vendas B2B',
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
