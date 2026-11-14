import type { ReactNode } from "react";
import { OverlayDrawer } from "@fluentui/react-components";

/** Loaded only on narrow layouts; desktop navigation does not need modal machinery. */
export default function NavigationDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <OverlayDrawer
      className="navigation-drawer"
      position="start"
      open={open}
      onOpenChange={(_, data) => onOpenChange(data.open)}
    >
      {children}
    </OverlayDrawer>
  );
}
