import DashboardLayout from '@/components/layout/DashboardLayout';
import { CollectionPointProvider } from '@/contexts/CollectionPointContext';

export default function DashboardLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CollectionPointProvider>
      <DashboardLayout>{children}</DashboardLayout>
    </CollectionPointProvider>
  );
}

