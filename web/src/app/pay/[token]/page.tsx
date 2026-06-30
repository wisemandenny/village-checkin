import { PayFlow } from "@/components/pay-flow";

export default async function PayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <PayFlow token={token} />
    </main>
  );
}
