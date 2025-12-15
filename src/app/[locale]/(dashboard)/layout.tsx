import DashboardLayout from '@/components/layout/DashboardLayout';
import { AuthProvider } from '@/contexts/AuthContext';
import { CollectionPointProvider } from '@/contexts/CollectionPointContext';

export default function DashboardLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <CollectionPointProvider>
        <DashboardLayout>{children}</DashboardLayout>
      </CollectionPointProvider>
    </AuthProvider>
  );
}

