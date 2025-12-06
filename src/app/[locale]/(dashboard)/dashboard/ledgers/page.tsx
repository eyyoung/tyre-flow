import { redirect } from 'next/navigation';

export default async function LedgersPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  redirect(`/${params.locale}/dashboard/ledgers/collection`);
}
