// Reveal one-liners. Placeholders: {word} = smuggled word, {name} = player
// name, {n} = a number.
export default {
  // Smuggler got away with the word.
  getaway: [
    '{word} walked right out the front door',
    'Nobody checked the trunk. {word} was in the trunk',
    '{word} cleared customs with a smile and a wave',
    '{word} was hiding in plain sight the whole time',
    '{name} carried {word} across the border in broad daylight',
    'Turns out {word} had a valid passport',
    '{word} left the building before anyone noticed it was there',
    'Security waved {word} straight through',
    '{word} slipped past. The cameras were pointed the other way',
    '{name} just smuggled {word} and got a round of applause for it',
    '{word} was in the sandwich. You ate the sandwich',
    '{word} took the scenic route and nobody followed',
    'The dogs sniffed {word} and went back to sleep',
    '{word} is already three towns away',
  ],
  // Got away with zero accusations.
  ghost: [
    'Not one accusation. {word} was never here',
    '{word} moved through the room like a rumor',
    'Zero suspects. Zero questions. {word} is a ghost',
    '{name} hid {word} so well the word forgot it was there',
    'Nobody even looked. {word} did not have to run',
    'The record shows {word} was never in the building',
    '{word} left no footprints, no fingerprints, no forwarding address',
    'No accusations. {name} could have smuggled a piano',
  ],
  // Smuggler caught.
  busted: [
    '{word}. Really. Right in the middle of the sentence',
    '{name} put {word} in there like nobody would notice',
    'The bag was checked. {word} was in the bag',
    '{word} set off every alarm on the way out',
    'Caught with {word} still in hand',
    '{name} smuggled {word} the way a toddler hides broccoli',
    '{word} was doing a terrible job of blending in',
    'The word was {word}. The word was very obvious',
    '{name} dropped {word} and everyone heard it hit the floor',
    'Nice try with {word}. It was not a nice try',
    '{word} was wearing a fake mustache and it did not help',
    'Found {word} in the first pocket they checked',
    '{name} said {word} out loud in a room full of witnesses',
    '{word} got caught by the slowest guard on shift',
  ],
  // {name} caught every smuggler.
  full_bust: [
    '{name} caught every single smuggler. No exceptions',
    '{name} saw all of it. All of it',
    'Every smuggler, every time. {name} is not messing around',
    '{name} ran a full sweep and found everything',
    '{name} cleared the room. Nobody got through',
    'Perfect record for {name}. The smugglers are filing a complaint',
    '{name} checked every bag and every bag had something in it',
    'Nothing got past {name} tonight',
  ],
  // No smugglers this round; {name} accused {n} people anyway.
  clean_round: [
    'No smugglers this round. {name} accused {n} of them anyway',
    'Nobody was hiding anything. {name} pointed at {n} of them',
    'It was a clean round. {name} still needed {n} of them as suspects',
    '{name} accused {n} of them. The room was empty of crime',
    'Nothing to find, and {name} searched {n} of them anyway',
    'Everyone was clean. {name} doubted {n} of them regardless',
    'Zero smugglers. Reports filed by {name}: {n}',
    '{name} accused {n} of them in a round with no crime',
    'Clean sheet. {name} searched {n} of them for nothing',
    'No contraband tonight. Bags {name} checked anyway: {n}',
  ],
  // Final: {name} hid {word} from {n} people.
  fooled: [
    '{name} slid {word} past {n} of them without breaking stride',
    '{n} of them read {word} and nodded along',
    '{name} hid {word} and {n} of them helped hide it',
    '{word} fooled {n} of them. {name} says nothing',
    '{n} of them looked right at {word} and did not notice',
    '{name} sold {word} to {n} of them and got a thank you',
    '{n} of them looked straight at {word} and saw a joke',
    '{word} got by {n} of them. {name} is taking a bow',
  ],
  // Final: nobody fell for {name}'s {word}.
  unfooled: [
    "Nobody fell for {name}'s {word}. Not even a little",
    '{name} tried {word}. The room was ready for it',
    '{word} was spotted from across the parking lot. Sorry, {name}',
    "Every single player clocked {name}'s {word}",
    '{name} brought {word} to a room full of detectives',
    'Zero people fooled. {word} was not subtle, {name}',
  ],
};
