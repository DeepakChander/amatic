import { WelcomeScreen } from "@amatic/amatic/index";
import React from "react";

export const AppWelcomeScreen: React.FC<{
  onCollabDialogOpen: () => any;
  isCollabEnabled: boolean;
}> = React.memo((props) => {
  // Ultra-clean interface - just the logo
  return (
    <WelcomeScreen>
      <WelcomeScreen.Center>
        <WelcomeScreen.Center.Logo />
      </WelcomeScreen.Center>
    </WelcomeScreen>
  );
});
