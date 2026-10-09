import { fireReminders } from '../../lib/reminders'

export function ReminderStatus(): string {
  return `${fireReminders(24)} reminder handlers notified`
}
