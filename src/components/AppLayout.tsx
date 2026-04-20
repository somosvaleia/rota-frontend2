import { ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Plus, Menu, X } from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Projetos" },
  { to: "/novo-projeto", icon: Plus, label: "Novo Projeto" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const SidebarContent = (
    <>
      <div className="p-6 border-b border-border">
        <Link to="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2">
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
              onClick={() => setMobileOpen(false)}
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
    </>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 inset-x-0 h-14 z-40 flex items-center justify-between px-4 border-b border-border bg-card/80 backdrop-blur-md">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <span className="font-display font-bold text-primary-foreground text-xs">R</span>
          </div>
          <span className="font-display text-base font-bold text-gradient">ROTA</span>
        </Link>
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded-lg hover:bg-secondary text-foreground"
          aria-label="Abrir menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 border-r border-border flex-col bg-card/50 backdrop-blur-sm">
        {SidebarContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] h-full flex flex-col bg-card border-r border-border animate-in slide-in-from-left">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-secondary text-foreground"
              aria-label="Fechar menu"
            >
              <X className="w-5 h-5" />
            </button>
            {SidebarContent}
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
