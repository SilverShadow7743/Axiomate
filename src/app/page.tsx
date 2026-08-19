export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 font-sans dark:bg-zinc-950">
      <main className="flex w-full max-w-2xl flex-col items-center gap-8 text-center">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium uppercase tracking-widest text-blue-600">
            Cloud Agent Environment
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Axiomate
          </h1>
          <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            AI-native web platform for technology consulting firms — lead
            generation, commercial modeling, delivery governance, and revenue
            automation.
          </p>
        </div>
        <div
          className="rounded-xl border border-zinc-200 bg-white px-6 py-4 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
          data-testid="environment-status"
        >
          Development environment is running. Next.js is ready.
        </div>
      </main>
    </div>
  );
}
