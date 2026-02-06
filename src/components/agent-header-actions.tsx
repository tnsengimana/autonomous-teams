"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

interface AgentHeaderActionsContextType {
  actions: ReactNode;
  setActions: (actions: ReactNode) => void;
}

const AgentHeaderActionsContext = createContext<AgentHeaderActionsContextType>({
  actions: null,
  setActions: () => {},
});

export function AgentHeaderActionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <AgentHeaderActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </AgentHeaderActionsContext.Provider>
  );
}

export function useAgentHeaderActions() {
  return useContext(AgentHeaderActionsContext);
}

// Component that pages render to inject their actions into the header
export function AgentHeaderActions({ children }: { children: ReactNode }) {
  const { setActions } = useAgentHeaderActions();
  useEffect(() => {
    setActions(children);
    return () => setActions(null);
  }, [children, setActions]);
  return null;
}

// Component rendered in the layout to display the actions
export function AgentHeaderActionsSlot() {
  const { actions } = useAgentHeaderActions();
  return <>{actions}</>;
}
