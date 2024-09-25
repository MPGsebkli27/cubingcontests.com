// IMPORT THIS FILE LIKE THIS:
// import C from '@sh/constants';

const C = {
  contactEmail: 'cubing-contests-admin@googlegroups.com',
  fetchThrottleTimeout: 600, // the timeout in ms between doing repetitive fetch requests that need to be limited
  // Timeouts before revalidating a request in seconds
  rankingsRev: 300, //  5 minutes
  contestsRev: 60, // 1 minute
  contestResultsRev: 30, // 30 seconds
  maxRounds: 10, // maximum number of rounds allowed
  maxTime: 24 * 60 * 60 * 100, // 24 hours (IF THIS IS EVER UPDATED, ALSO CONSIDER THE LINES WITH 24000000 IN AttemptInput)
  maxFmMoves: 999,
  maxTimeLimit: 60 * 60 * 100, // 1 hour
  minCompetitorLimit: 5,
  minCompetitorsForNonWca: 3,
  maxConfirmationCodeAttempts: 3,
  minProceedNumber: 3,
  maxProceedPercentage: 75,
  maxMeetupRounds: 15,
  confirmationCodeCooldown: 5 * 60 * 1000, // in milliseconds (5 minutes)
  passwordResetSessionLength: 3, // in days
  passwordSaltRounds: 10,
  wcaApiBase: 'https://raw.githubusercontent.com/robiningelbrecht/wca-rest-api/master/api',
  wcaIdRegex: /[0-9]{4}[A-Z]{4}[0-9]{2}/,
  wcaIdRegexLoose: /[0-9]{4}[a-zA-Z]{4}[0-9]{2}/, // allows lowercase letters too
  navigationKeys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'],
  moneroDonationAddress:
    '8AaML2et9RQKmZp4NYm9STKbjhfFB4h81ZxeGV166oapNzPFUTneaRmakwE61cyHr1ZUYreEU7eHF8XmMBykG8TpAwM6SVq',
};

export default C;
