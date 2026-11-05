export const LANGS = ['pt', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export const T = {
  pt: {
    tagline: 'Estudos práticos de cloud, arquitetura, engenharia de software e IA, com teste, benchmark e dado.',
    posts: 'Artigos',
    about: 'Como eu escrevo',
    empty: 'Os primeiros experimentos estão sendo medidos. O primeiro artigo sai em breve.',
    other: 'English',
    back: 'Todos os artigos',
    aiNote: 'Os experimentos, os dados e as conclusões são do autor. A redação é assistida por IA e revisada por ele.',
    aboutBody: [
      'Cada artigo parte de uma pergunta que dá para medir: isso funciona? Vale o custo? Quanto ganha? Eu rodo o experimento, guardo os dados e escrevo a conclusão, inclusive quando a resposta é "não vale a pena".',
      'Uso IA para ajudar na redação e para melhorar os testes. Ela escreve a partir das minhas notas e dos meus dados; eu reproduzo, reviso e aprovo cada texto antes de publicar. Nenhum número entra sem uma medição registrada.',
      'Os experimentos e os dados brutos ficam em repositórios públicos, para você repetir o teste e discordar.',
    ],
  },
  en: {
    tagline: 'Hands-on studies of cloud, architecture, software engineering and AI, with tests, benchmarks and data.',
    posts: 'Articles',
    about: 'How I write',
    empty: 'The first experiments are being measured. The first article is coming soon.',
    other: 'Português',
    back: 'All articles',
    aiNote: "The experiments, data and conclusions are the author's. The writing is AI-assisted and reviewed by him.",
    aboutBody: [
      'Every article starts from a question I can measure: does it work? Is it worth the cost? How much does it gain? I run the experiment, keep the data and write the conclusion, including when the answer is "not worth it".',
      'I use AI to help with the writing and to improve the tests. It writes from my notes and my data; I reproduce, review and approve every text before publishing. No number goes in without a recorded measurement.',
      'Experiments and raw data live in public repositories, so you can repeat the test and disagree.',
    ],
  },
} as const;
