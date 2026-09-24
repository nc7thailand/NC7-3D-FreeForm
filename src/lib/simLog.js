// Sim track log is sampled at 10 Hz for the whole job; keep a bounded window
// so long runs on low-RAM machines do not grow the log (and its DOM table)
// without limit.
export const SIM_LOG_MAX_ROWS = 5000
/** Rows rendered in the on-screen log table (Copy still exports every kept row). */
export const SIM_LOG_VIEW_ROWS = 300

export function pushSimLog(log, row) {
  log.push(row)
  if (log.length > SIM_LOG_MAX_ROWS) log.splice(0, log.length - SIM_LOG_MAX_ROWS)
}
