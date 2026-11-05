"use strict";

const readingLessons = [
  {
    id: "a-picnic-in-the-park",
    title: "A Picnic in the Park",
    level: "A1",
    topic: "Еда и свободное время",
    minutes: 1,
    description: "Мия и её брат обедают в парке.",
    words: {
      picnic: "пикник",
      sandwiches: "бутерброды",
      blanket: "плед",
      ducks: "утки"
    },
    paragraphs: [
      [
        "It is Sunday. Mia and her brother Ben go to the park. They want to have a ",
        {word: "picnic"},
        ". Mia has two ",
        {word: "sandwiches"},
        " and an apple. Ben has water."
      ],
      [
        "They sit on a red ",
        {word: "blanket"},
        " under a tree. Mia eats a sandwich. Ben eats the other sandwich. Then they share the apple."
      ],
      [
        "After lunch, Mia and Ben walk to the lake. They see three ",
        {word: "ducks"},
        ". At two o’clock, they go home."
      ]
    ],
    questions: [
      {
        prompt: "What day is it?",
        choices: ["Monday", "Sunday", "Friday"],
        answer: 1,
        paragraph: 0,
        explanation: "В первом предложении сказано, что сегодня воскресенье."
      },
      {
        prompt: "What does Ben bring?",
        choices: ["An apple", "Juice", "Water"],
        answer: 2,
        paragraph: 0,
        explanation: "У Бена с собой вода. Яблоко принесла Мия."
      },
      {
        prompt: "What colour is the blanket?",
        choices: ["Red", "Blue", "Green"],
        answer: 0,
        paragraph: 1,
        explanation: "Мия и Бен сидят под деревом на красном пледе."
      },
      {
        prompt: "Mia and Ben see two ducks.",
        choices: ["True", "False"],
        answer: 1,
        paragraph: 2,
        explanation: "У озера они видят трёх уток."
      },
      {
        prompt: "When do they go home?",
        choices: ["At one o’clock", "At three o’clock", "At two o’clock"],
        answer: 2,
        paragraph: 2,
        explanation: "В последнем предложении сказано, что они идут домой в два часа."
      }
    ]
  },
  {
    id: "a-plant-on-the-bus",
    title: "A Plant on the Bus",
    level: "A2",
    topic: "Повседневная жизнь",
    minutes: 2,
    description: "Поездка на рынок, бумажный пакет и неожиданная встреча.",
    words: {
      pot: "цветочный горшок",
      soil: "земля, почва",
      swap: "обмениваться",
      mint: "мята"
    },
    paragraphs: [
      [
        "On Saturday morning, Lina took the bus to the market. At stop six, an older man got on with a small plant. He sat beside Lina and held the ",
        {word: "pot"},
        " with both hands."
      ],
      [
        "When the bus turned a corner, a little ",
        {word: "soil"},
        " fell on the floor. The man looked worried. Lina took an empty paper bag from her backpack. They put the pot inside the bag, and the rest of the soil stayed inside."
      ],
      [
        "At the market, Lina saw the man again. He was standing beside a table with a sign that said, “",
        {word: "swap", text: "Swap"},
        " a plant.” He told her she could take a plant if she brought one to share."
      ],
      [
        "The next Saturday, Lina came back with a plant from her kitchen. She put it on the table and chose a small ",
        {word: "mint"},
        " plant. On the bus home, she kept it in a paper bag."
      ]
    ],
    questions: [
      {
        prompt: "Where was Lina going at the start of the story?",
        choices: ["To a park", "To the market", "To a friend’s house"],
        answer: 1,
        paragraph: 0,
        explanation: "В первом абзаце сказано, что Лина ехала на рынок."
      },
      {
        prompt: "Why did Lina take a paper bag from her backpack?",
        choices: ["To carry her lunch", "To clean the bus window", "To keep more soil off the bus floor"],
        answer: 2,
        paragraph: 1,
        explanation: "Земля просыпалась на пол. Пакет помог удержать её внутри."
      },
      {
        prompt: "At the market, Lina could take a plant if she brought one to share.",
        choices: ["True", "False"],
        answer: 0,
        paragraph: 2,
        explanation: "Мужчина объяснил правило обмена. Чтобы взять растение, нужно принести своё."
      },
      {
        prompt: "What did Lina choose the next Saturday?",
        choices: ["A larger pot", "A mint plant", "A new backpack"],
        answer: 1,
        paragraph: 3,
        explanation: "Лина принесла своё растение и выбрала мяту."
      },
      {
        prompt: "How did Lina carry her plant on the bus home?",
        choices: ["She sat near the driver.", "She left the plant at the market.", "She carried her plant in a paper bag."],
        answer: 2,
        paragraph: 3,
        explanation: "На обратном пути Лина сразу держала растение в бумажном пакете."
      }
    ]
  }
];
