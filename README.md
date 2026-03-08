# NOJV

A Next.js project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app), featuring a modern full-stack setup.

## Tech Stack

| Tool                                               | Purpose                          |
| -------------------------------------------------- | -------------------------------- |
| [Next.js](https://nextjs.org)                      | React framework with App Router  |
| [Vite / Vitest](https://vitest.dev)                | Unit testing                     |
| [pnpm](https://pnpm.io)                            | Package manager                  |
| [ESLint](https://eslint.org)                       | Code linting                     |
| [Prettier](https://prettier.io)                    | Code formatting                  |
| [Docker Compose](https://docs.docker.com/compose/) | Container orchestration          |
| [Prisma](https://www.prisma.io)                    | ORM and database migrations      |
| [ECharts](https://echarts.apache.org)              | Data visualization               |
| [TailwindCSS](https://tailwindcss.com)             | Utility-first CSS                |
| [Google GenAI](https://ai.google.dev)              | Generative AI integration        |
| [Zod](https://zod.dev)                             | Schema validation                |
| [next-intl](https://next-intl.dev)                 | Internationalization (en / 中文) |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 22+
- [pnpm](https://pnpm.io) 10+
- [Docker](https://www.docker.com) (optional, for the database)

### Local Development

1. Copy the environment file and fill in your values:

```bash
cp .env.example .env
```

2. Start the PostgreSQL database with Docker Compose:

```bash
docker compose up db -d
```

3. Install dependencies and run migrations:

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
```

4. Start the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Running with Docker Compose (full stack)

```bash
docker compose up
```

## Available Scripts

| Command              | Description                  |
| -------------------- | ---------------------------- |
| `pnpm dev`           | Start the development server |
| `pnpm build`         | Build for production         |
| `pnpm start`         | Start the production server  |
| `pnpm lint`          | Run ESLint                   |
| `pnpm format`        | Format code with Prettier    |
| `pnpm format:check`  | Check code formatting        |
| `pnpm test`          | Run unit tests               |
| `pnpm test:watch`    | Run tests in watch mode      |
| `pnpm test:coverage` | Run tests with coverage      |
| `pnpm db:generate`   | Generate Prisma client       |
| `pnpm db:migrate`    | Run database migrations      |
| `pnpm db:studio`     | Open Prisma Studio           |
| `pnpm db:push`       | Push schema to database      |

## Project Structure

```
src/
├── app/
│   └── [locale]/         # i18n locale routing
│       ├── layout.tsx    # Root layout with next-intl provider
│       └── page.tsx      # Home page
├── components/
│   └── DemoChart.tsx     # ECharts demo component
├── i18n/
│   ├── request.ts        # next-intl request config
│   └── routing.ts        # Locale routing definition
├── lib/
│   ├── genai.ts          # Google GenAI utilities
│   ├── prisma.ts         # Prisma client singleton
│   └── schemas.ts        # Zod validation schemas
├── middleware.ts          # next-intl middleware
└── __tests__/
    └── schemas.test.ts   # Vitest unit tests
messages/
├── en.json               # English translations
└── zh.json               # Chinese translations
prisma/
└── schema.prisma         # Database schema
```

## Environment Variables

| Variable            | Description                  |
| ------------------- | ---------------------------- |
| `DATABASE_URL`      | PostgreSQL connection string |
| `GOOGLE_AI_API_KEY` | Google AI Studio API key     |
