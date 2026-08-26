import { TRBadge } from "@tinyrack/ui/components/badge";
import { TRButton } from "@tinyrack/ui/components/button";
import { TRCodeBlock } from "@tinyrack/ui/components/code-block";
import { TRCopyButton } from "@tinyrack/ui/components/copy-button";
import { TRTabs } from "@tinyrack/ui/components/tabs";
import { TRText } from "@tinyrack/ui/components/text";
import { TRWindowFrame } from "@tinyrack/ui/components/window-frame";
import { GlobeBackground } from "./globe-background.tsx";
import { installTargets, terminalSteps } from "./proxer-hero-content.ts";

type ProxerHomeProps = {
  body: string;
  features: readonly string[];
  getStartedLabel: string;
  getStartedPath: string;
  installLabel: string;
  tagline: string;
  terminalLabel: string;
};

export function ProxerHome({
  body,
  features,
  getStartedLabel,
  getStartedPath,
  installLabel,
  tagline,
  terminalLabel,
}: ProxerHomeProps) {
  return (
    <section className="proxer-home">
      <GlobeBackground />
      <div className="proxer-home-content">
        <div className="proxer-home-lede">
          <TRBadge variant="success">Proxer v{__CLI_VERSION__}</TRBadge>
          <TRText as="h1" variant="display">
            {tagline}
          </TRText>
          <TRText
            as="p"
            className="proxer-home-copy"
            color="muted"
            variant="body"
          >
            {body}
          </TRText>
          <ul className="proxer-features">
            {features.map((feature) => (
              <li key={feature}>
                <TRBadge variant="neutral">{feature}</TRBadge>
              </li>
            ))}
          </ul>
          <div className="proxer-home-actions">
            <TRButton
              render={<a href={getStartedPath} />}
              intent="primary"
              uiSize="md"
            >
              {getStartedLabel}
            </TRButton>
            <TRButton
              render={<a href="https://github.com/tinyrack-net/proxer" />}
              appearance="outline"
              uiSize="md"
            >
              GitHub →
            </TRButton>
          </div>
          <TRTabs.Root
            className="proxer-install"
            defaultValue={installTargets[0].value}
          >
            <TRTabs.List aria-label={installLabel}>
              {installTargets.map((target) => (
                <TRTabs.Tab key={target.value} value={target.value}>
                  {target.label}
                </TRTabs.Tab>
              ))}
              <TRTabs.Indicator />
            </TRTabs.List>
            {installTargets.map((target) => (
              <TRTabs.Panel key={target.value} value={target.value}>
                <div className="proxer-install-command">
                  <TRCodeBlock code={target.command} language="bash" />
                  <TRCopyButton
                    appearance="ghost"
                    uiSize="sm"
                    value={target.command}
                  />
                </div>
              </TRTabs.Panel>
            ))}
          </TRTabs.Root>
        </div>

        <TRWindowFrame.Root
          aria-label={terminalLabel}
          className="proxer-terminal"
          variant="macos"
        >
          <TRWindowFrame.TitleBar>
            <TRWindowFrame.Controls aria-hidden="true">
              <TRWindowFrame.Control tone="close" />
              <TRWindowFrame.Control tone="minimize" />
              <TRWindowFrame.Control tone="maximize" />
            </TRWindowFrame.Controls>
            <TRWindowFrame.Title>proxer</TRWindowFrame.Title>
          </TRWindowFrame.TitleBar>
          <TRWindowFrame.Body padding="none">
            <div className="proxer-terminal-transcript">
              {terminalSteps.map((step) => (
                <div className="proxer-terminal-step" key={step}>
                  <TRCodeBlock code={step} language="bash" />
                </div>
              ))}
              <span aria-hidden="true" className="proxer-terminal-caret" />
            </div>
          </TRWindowFrame.Body>
        </TRWindowFrame.Root>
      </div>
    </section>
  );
}
