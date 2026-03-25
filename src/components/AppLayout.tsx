import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Plus, Settings } from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Projetos" },
  { to: "/novo-projeto", icon: Plus, label: "Novo Projeto" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border flex flex-col bg-card/50 backdrop-blur-sm">
        <div className="p-6 border-b border-border">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="font-display font-bold text-primary-foreground text-sm">R</span>
            </div>
            <span className="font-display text-xl font-bold text-gradient">ROTA</span>
          </Link>
          <p className="text-xs text-muted-foreground mt-1">Automação de Projetos</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? "bg-primary/10 text-primary glow-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="glass-card rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Versão 1.0</p>
            <p className="text-xs text-primary font-medium">Sistema ROTA</p>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
