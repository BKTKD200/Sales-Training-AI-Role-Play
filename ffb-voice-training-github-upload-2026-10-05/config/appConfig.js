export const centers = [
  "Freehold",
  "Marlboro",
  "Manalapan",
  "Test",
  "Fairless Hills",
  "Hillsboro",
];

export const employeesByCenter = {
  Freehold: ["Jenn N."],
  Marlboro: ["Charlie T."],
  Manalapan: ["Mary V."],
  Test: ["Bryan K."],
  "Fairless Hills": ["Shannon"],
  Hillsboro: ["Paul"],
};

export const brandByCenter = {
  Freehold: "MAX",
  Marlboro: "MAX",
  Manalapan: "MAX",
  Test: "MAX",
  "Fairless Hills": "MAX",
  Hillsboro: "MAX",
};

export const brands = {
  MAX: {
    displayName: "MAX",
    editableFacts: [
      "Use only facts configured here or facts the employee supplies during the role-play.",
      "Do not invent prices, schedules, policies, trial terms, fees, nutrition details, or offers.",
    ],
  },
  FXB: {
    displayName: "FXB",
    editableFacts: [
      "Use only facts configured here or facts the employee supplies during the role-play.",
      "Do not invent prices, schedules, policies, trial terms, fees, nutrition details, or offers.",
    ],
  },
};

export const prospectProfiles = [
  {
    id: "returning-beginner",
    label: "Returning beginner",
    surface: "Has exercised before but feels rusty and uncertain about restarting.",
    hiddenMotivation: "Wants a structured path back into fitness without feeling embarrassed.",
    hiddenBarriers: "Worries about being behind everyone else and not knowing the movements.",
  },
  {
    id: "busy-parent",
    label: "Busy parent or professional",
    surface: "Has limited time and is trying to decide whether this can fit their week.",
    hiddenMotivation: "Needs energy and consistency, not another complicated commitment.",
    hiddenBarriers: "Schedule pressure and fear of paying for something they cannot attend.",
  },
  {
    id: "already-active",
    label: "Already-active prospect",
    surface: "Currently exercises and wants to understand what this adds.",
    hiddenMotivation: "Wants better structure, accountability, or variety.",
    hiddenBarriers: "May resist being sold a total replacement for their current routine.",
  },
  {
    id: "runner-strength",
    label: "Runner seeking strength training",
    surface: "Runs regularly and is curious about strength training support.",
    hiddenMotivation: "Wants to feel stronger, prevent nagging injuries, and improve running.",
    hiddenBarriers: "Does not want a program that conflicts with running goals.",
  },
  {
    id: "pilates-yoga-cardio",
    label: "Pilates/yoga participant seeking cardio",
    surface: "Enjoys Pilates or yoga and is looking for more cardio and conditioning.",
    hiddenMotivation: "Wants a complementary routine that adds intensity without losing what they like.",
    hiddenBarriers: "Worries the program will be too aggressive or not aligned with their current practice.",
  },
  {
    id: "skeptical-past-program",
    label: "Skeptical prospect with past program experience",
    surface: "Has tried another program before and is cautious about trying again.",
    hiddenMotivation: "Wants evidence that this will feel more personal and sustainable.",
    hiddenBarriers: "Past disappointment, sales pressure, or not feeling supported.",
  },
  {
    id: "postpartum-baby-weight",
    label: "Postpartum prospect rebuilding after having a baby",
    surface: "Recently had a baby and is interested in getting back into a fitness routine.",
    hiddenMotivation: "Wants to feel like herself again, rebuild strength and energy, and feel comfortable in her body.",
    hiddenBarriers: "Schedule unpredictability, childcare, fatigue, confidence, and concern about starting too aggressively.",
  },
  {
    id: "wedding-prep",
    label: "Prospect getting ready for a wedding",
    surface: "Has a wedding coming up and wants to feel confident and consistent before the date.",
    hiddenMotivation: "Wants structure, accountability, and visible progress before a meaningful event.",
    hiddenBarriers: "Timeline pressure, fear of overcommitting, and uncertainty about what is realistic before the wedding.",
  },
  {
    id: "doctor-recommended",
    label: "Prospect prompted by a doctor or health wake-up call",
    surface: "Has been told they should become more active and wants help getting started safely.",
    hiddenMotivation: "Wants better health, stamina, and confidence that they are doing the right things.",
    hiddenBarriers: "Fear of judgment, medical limitations, and not knowing what level of intensity is appropriate.",
  },
  {
    id: "empty-nester-reset",
    label: "Empty nester or life-transition prospect",
    surface: "Has more time than before and is thinking about finally prioritizing fitness.",
    hiddenMotivation: "Wants a fresh routine, community, and a reason to stay consistent.",
    hiddenBarriers: "Has been out of a structured fitness routine for years and worries about fitting in.",
  },
  {
    id: "former-athlete",
    label: "Former athlete wanting structure again",
    surface: "Used to be active or athletic and wants to get back to feeling strong.",
    hiddenMotivation: "Misses having a structured, coached environment and measurable progress.",
    hiddenBarriers: "Frustration that current fitness is not where it used to be and concern about injury or ego getting in the way.",
  },
];

export const curveBallChallenges = {
  price: {
    label: "Price objection",
    instruction: "Raise one natural price concern after the employee has had a fair chance to ask Discovery questions. Do not ask for exact pricing unless the employee brings price up first. If they answer, allow a strong follow-up to move the call forward.",
  },
  partner: {
    label: "Needs to check with spouse/partner",
    instruction: "Raise one natural need-to-check-with-spouse-or-partner concern after the employee has had a fair chance to ask Discovery questions. Let the employee explore decision-making and scheduling. Do not add a price objection.",
  },
  random: {
    label: "Random objection",
    instruction: "Use the selected random objection naturally after the employee has had a fair chance to ask Discovery questions. Do not stack objections.",
  },
};

export const randomObjections = [
  "I am not sure I have enough time right now.",
  "I am worried I will be too out of shape.",
  "I need to think about whether this fits with my current workouts.",
  "I had a program not work out before, so I am hesitant.",
];
