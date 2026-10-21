import { listTasks } from "@taskbot/jobs";
import { errorDetails, getEnv, logger, type TaskDTO } from "@taskbot/shared";
import { Dashboard } from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let tasks: TaskDTO[] = [];
  let loadError: string | null = null;
  try {
    tasks = await listTasks();
  } catch (err) {
    logger.error({ err: errorDetails(err) }, "dashboard failed to load tasks");
    loadError = "Couldn't load tasks from the database. Live updates will retry automatically.";
  }

  return (
    <Dashboard
      initialTasks={tasks}
      botUsername={getEnv().TELEGRAM_BOT_USERNAME ?? null}
      loadError={loadError}
    />
  );
}
