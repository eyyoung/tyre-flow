// Next.js Instrumentation - runs when the server starts
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // 只在服务端运行
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 动态导入以避免在客户端加载
    const { startRoutePlanScheduler } = await import('./lib/route-plan-scheduler');
    startRoutePlanScheduler();
  }
}
