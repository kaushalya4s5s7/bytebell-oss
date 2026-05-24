// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import React from "react";
import { render } from "ink";
import { StopInfraPrompt } from "./StopInfraPrompt.tsx";

export async function promptStopDocker(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const app = render(
      React.createElement(StopInfraPrompt, {
        onDone: (stop: boolean) => {
          app.unmount();
          resolve(stop);
        },
      }),
    );
  });
}
