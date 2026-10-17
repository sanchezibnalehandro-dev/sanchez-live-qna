// Pure event vote rules shared by guest UI and tests.
// The database enforces these independently.
export const ELINA_28_EVENT_KEYS = Object.freeze(['elina-28-2026', 'elina-28-rehearsal']);

export const AUDIENCE_TEAMS = Object.freeze([
  { no: 1, label: 'Production' },
  { no: 2, label: 'Healthcare' },
  { no: 3, label: 'New Markets' },
  { no: 4, label: 'Smart City' },
  { no: 5, label: 'Partnership' }
]);

export function teamOptions(ownTeam) {
  return AUDIENCE_TEAMS.filter(team => team.no !== ownTeam);
}

export function isValidTeam(no) {
  return Number.isInteger(no) && no >= 1 && no <= 5;
}

export function canSubmitChoice(ownTeam, votedTeam) {
  return isValidTeam(ownTeam) && isValidTeam(votedTeam) && ownTeam !== votedTeam;
}

export function voteButtonVisible(status) {
  return status === 'open';
}
