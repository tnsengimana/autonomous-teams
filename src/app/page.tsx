import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect("/inbox");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans">
      {/* Hero Section */}
      <header className="container mx-auto flex items-center justify-between px-4 py-6">
        <div className="text-xl font-bold">Autonomous Teams</div>
        <Link href="/auth/signin">
          <Button variant="outline">Sign In</Button>
        </Link>
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="container mx-auto flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Create teams of AI agents
            <br />
            <span className="text-muted-foreground">that work for you 24/7</span>
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Build autonomous AI teams that run continuously to fulfill your mission.
            Your agents collaborate, learn, and proactively deliver insights -
            even while you sleep.
          </p>
          <div className="flex gap-4">
            <Link href="/auth/signin">
              <Button size="lg">Get Started</Button>
            </Link>
            <Link href="#features">
              <Button size="lg" variant="outline">
                Learn More
              </Button>
            </Link>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-t bg-muted/50">
          <div className="container mx-auto px-4 py-16">
            <h2 className="mb-12 text-center text-3xl font-bold">
              How It Works
            </h2>
            <div className="grid gap-8 md:grid-cols-3">
              <div className="rounded-lg border bg-card p-6">
                <div className="mb-4 text-4xl">1</div>
                <h3 className="mb-2 text-xl font-semibold">Define Your Mission</h3>
                <p className="text-muted-foreground">
                  Create a team with a clear mission and objectives. Your team lead
                  will coordinate all activities toward this goal.
                </p>
              </div>
              <div className="rounded-lg border bg-card p-6">
                <div className="mb-4 text-4xl">2</div>
                <h3 className="mb-2 text-xl font-semibold">Build Your Team</h3>
                <p className="text-muted-foreground">
                  Add specialized subordinate agents with unique skills. They spawn on-demand
                  to handle research, analysis, and more.
                </p>
              </div>
              <div className="rounded-lg border bg-card p-6">
                <div className="mb-4 text-4xl">3</div>
                <h3 className="mb-2 text-xl font-semibold">Get Proactive Insights</h3>
                <p className="text-muted-foreground">
                  Your agents run continuously, extracting memories and delivering
                  briefings and feedback to your inbox.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t">
          <div className="container mx-auto flex flex-col items-center gap-6 px-4 py-16 text-center">
            <h2 className="text-3xl font-bold">Ready to get started?</h2>
            <p className="max-w-md text-muted-foreground">
              Create your first autonomous team in minutes. No credit card required.
            </p>
            <Link href="/auth/signin">
              <Button size="lg">Start Building</Button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          Autonomous Teams - AI-powered collaboration
        </div>
      </footer>
    </div>
  );
}
