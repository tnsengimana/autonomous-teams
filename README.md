# Autonomous Agents

A TypeScript/Next.js application where users create entities that run continuously to fulfill a mission. Each entity has a system prompt, a knowledge graph, and runs in a 5-minute iteration loop where it autonomously researches and learns using web search and graph tools.

## IMPORTANT: UI Change Policy

**ALL UI CHANGES REQUIRE EXPLICIT USER APPROVAL BEFORE IMPLEMENTATION.**

This includes but is not limited to:
- Adding or removing buttons
- Changing layouts or styling
- Adding new UI components
- Modifying existing component behavior
- Any visual changes whatsoever

Do not make any UI changes without first describing the proposed change and receiving explicit approval.

## Getting Started

`docker compose up` starts Postgres, runs migrations, and launches the Next.js dev server and background worker.

```bash
docker compose up
```

Ensure `.env.local` exists (Compose loads it automatically).

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Learn More

The project uses the following libraries:

* [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).
* [Drizzle](https://orm.drizzle.team/) for ORM and database migration. See [their documentation](https://orm.drizzle.team/docs/overview) for more details.
* [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Deployment

### Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
