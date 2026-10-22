const cron = require('node-cron');
const { sendDailySummary, sendWeeklySummary } = require('./discord');
const { sendDayBeforeReminders } = require('./pushReminders');
const { refreshAll } = require('./timetable');

/**
 * Starts the scheduled tasks (Europe/Paris time):
 * - 18:00: daily Discord summary and day-before push reminders (assignments due
 *   tomorrow and not done yet);
 * - Saturday 09:00: weekly Discord summary;
 * - every 30 minutes: ICS timetables, so the version kept in the database stays up
 *   to date even if nobody opens the page, and serves as a fallback when the
 *   source goes down. A first run happens shortly after startup, once the
 *   migrations are applied.
 */
function initScheduler() {
  cron.schedule('00 18 * * *', async () => {
    console.log('Scheduled task: sending the daily summary');
    try {
      await sendDailySummary();
    } catch (error) {
      console.error('Scheduled task failed:', error);
    }
  }, {
    timezone: "Europe/Paris"
  });

  cron.schedule('00 18 * * *', async () => {
    try {
      await sendDayBeforeReminders();
    } catch (error) {
      console.error('Failed to send the push reminders:', error);
    }
  }, {
    timezone: "Europe/Paris"
  });

  cron.schedule("00 9 * * 6", async () => {
    console.log("Scheduled task: sending the weekly summary");
    try {
      await sendWeeklySummary();
    } catch (error) {
      console.error("Scheduled task failed:", error);
    }
  }, {
    timezone: "Europe/Paris"
  });

  cron.schedule('*/30 * * * *', refreshTimetables, {
    timezone: "Europe/Paris"
  });
  setTimeout(refreshTimetables, 30 * 1000).unref();

  console.log('Scheduler started: daily summary and push reminders at 18:00, weekly summary on Saturday at 09:00, timetables every 30 min');
}

let refreshInProgress = false;

/** A slow run must not overlap the next one. */
async function refreshTimetables() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  try {
    const { ok, failed } = await refreshAll();
    if (ok || failed) {
      console.log(`Timetables refreshed: ${ok} up to date, ${failed} failed`);
    }
  } catch (error) {
    console.error('Failed to refresh the timetables:', error);
  } finally {
    refreshInProgress = false;
  }
}

module.exports = {
  initScheduler
};
