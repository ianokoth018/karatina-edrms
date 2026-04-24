import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

/**
 * Shared base layout for every transactional email the EDRMS sends.
 *
 *  ┌─────────────────────────────────┐
 *  │  Green KARU header + logo       │
 *  ├─────────────────────────────────┤
 *  │  White body                     │
 *  │   - Heading                     │
 *  │   - Greeting + paragraphs       │
 *  │   - Optional metadata box       │
 *  │   - Optional gold/green CTA     │
 *  ├─────────────────────────────────┤
 *  │  Hr                             │
 *  │  Disclaimer + footer copyright  │
 *  └─────────────────────────────────┘
 *
 * Styling targets the lowest-common-denominator email clients (Gmail,
 * Outlook, Apple Mail, mobile webviews) — explicit hex, inline styles,
 * no CSS variables, no rgba (Outlook drops it), nested tables under the
 * hood courtesy of @react-email/components.
 */

export const KARU_GREEN = "#02773b";
export const KARU_GREEN_DARK = "#025f2f";
export const KARU_GOLD = "#dd9f42";
const TEXT_PRIMARY = "#1f2937";
const TEXT_MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const PAGE_BG = "#f3f4f6";

export interface MetadataItem {
  label: string;
  value: string;
}

export interface KaruEmailLayoutProps {
  /** Short summary shown in inbox previews — keep ≤ 90 chars */
  preview: string;
  /** Heading at the top of the body section */
  heading: string;
  /** Recipient name for the greeting (omit to skip greeting) */
  recipientName?: string;
  /** Free-form body content — paragraphs, JSX, anything */
  children: React.ReactNode;
  /** Optional table of facts shown above the CTA */
  metadata?: MetadataItem[];
  /** Optional call-to-action button */
  cta?: { label: string; url: string };
  /** Optional second smaller link below the CTA */
  secondaryLink?: { label: string; url: string };
  /** Disclaimer paragraph above the footer; defaults to a generic line */
  disclaimer?: string;
}

function getBaseUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://edrms.karu.ac.ke"
  );
}

export default function KaruEmailLayout({
  preview,
  heading,
  recipientName,
  children,
  metadata,
  cta,
  secondaryLink,
  disclaimer,
}: KaruEmailLayoutProps) {
  const baseUrl = getBaseUrl();
  const year = new Date().getFullYear();

  return (
    <Html>
      <Head />
      <Body
        style={{
          backgroundColor: PAGE_BG,
          margin: 0,
          padding: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          color: TEXT_PRIMARY,
        }}
      >
        <Preview>{preview}</Preview>
        <Container
          style={{
            backgroundColor: PAGE_BG,
            padding: "24px 16px",
            margin: "0 auto",
            maxWidth: "640px",
          }}
        >
          {/* Card */}
          <Section
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "12px",
              overflow: "hidden",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              border: `1px solid ${BORDER}`,
            }}
          >
            {/* KARU green header band with logo */}
            <Section
              style={{
                backgroundColor: KARU_GREEN,
                padding: "24px 32px",
                textAlign: "center" as const,
              }}
            >
              <Img
                src={`${baseUrl}/karu-crest.png`}
                width="56"
                height="56"
                alt="Karatina University crest"
                style={{
                  display: "inline-block",
                  margin: "0 auto",
                  borderRadius: "50%",
                  backgroundColor: "#ffffff",
                  padding: "4px",
                }}
              />
              <Text
                style={{
                  color: "#ffffff",
                  fontSize: "18px",
                  fontWeight: 700,
                  letterSpacing: "0.5px",
                  margin: "12px 0 0 0",
                  lineHeight: "1.2",
                }}
              >
                Karatina University EDRMS
              </Text>
              <Text
                style={{
                  color: "#d1fae5",
                  fontSize: "12px",
                  margin: "4px 0 0 0",
                  letterSpacing: "0.3px",
                }}
              >
                Electronic Document &amp; Records Management
              </Text>
            </Section>

            {/* Body section */}
            <Section style={{ padding: "32px" }}>
              <Text
                style={{
                  color: TEXT_PRIMARY,
                  fontSize: "20px",
                  fontWeight: 700,
                  margin: "0 0 16px 0",
                  lineHeight: "1.3",
                }}
              >
                {heading}
              </Text>

              {recipientName && (
                <Text
                  style={{
                    color: TEXT_PRIMARY,
                    fontSize: "14px",
                    lineHeight: "1.6",
                    margin: "0 0 16px 0",
                  }}
                >
                  Dear {recipientName},
                </Text>
              )}

              <div
                style={{
                  color: TEXT_PRIMARY,
                  fontSize: "14px",
                  lineHeight: "1.7",
                }}
              >
                {children}
              </div>

              {/* Metadata fact box */}
              {metadata && metadata.length > 0 && (
                <Section
                  style={{
                    backgroundColor: "#f9fafb",
                    border: `1px solid ${BORDER}`,
                    borderRadius: "8px",
                    padding: "16px 20px",
                    margin: "20px 0 0 0",
                  }}
                >
                  {metadata.map((item, idx) => (
                    <table
                      key={item.label}
                      width="100%"
                      cellPadding={0}
                      cellSpacing={0}
                      style={{
                        marginTop: idx === 0 ? 0 : 8,
                      }}
                    >
                      <tbody>
                        <tr>
                          <td
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              color: TEXT_MUTED,
                              textTransform: "uppercase",
                              letterSpacing: "0.6px",
                              width: "40%",
                              verticalAlign: "top",
                              paddingRight: "12px",
                            }}
                          >
                            {item.label}
                          </td>
                          <td
                            style={{
                              fontSize: "14px",
                              color: TEXT_PRIMARY,
                              fontWeight: 500,
                              verticalAlign: "top",
                              wordBreak: "break-word" as const,
                            }}
                          >
                            {item.value}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  ))}
                </Section>
              )}

              {/* CTA */}
              {cta && (
                <Section style={{ textAlign: "center" as const, padding: "28px 0 4px 0" }}>
                  <Button
                    href={cta.url}
                    style={{
                      backgroundColor: KARU_GREEN,
                      color: "#ffffff",
                      padding: "12px 28px",
                      borderRadius: "8px",
                      fontSize: "14px",
                      fontWeight: 600,
                      textDecoration: "none",
                      display: "inline-block",
                      letterSpacing: "0.3px",
                    }}
                  >
                    {cta.label}
                  </Button>
                </Section>
              )}

              {secondaryLink && (
                <Text
                  style={{
                    textAlign: "center" as const,
                    fontSize: "13px",
                    margin: "12px 0 0 0",
                    color: TEXT_MUTED,
                  }}
                >
                  <Link
                    href={secondaryLink.url}
                    style={{ color: KARU_GREEN, textDecoration: "underline" }}
                  >
                    {secondaryLink.label}
                  </Link>
                </Text>
              )}
            </Section>

            <Hr style={{ borderColor: BORDER, margin: 0 }} />

            {/* Disclaimer */}
            <Section style={{ padding: "20px 32px" }}>
              <Text
                style={{
                  fontSize: "12px",
                  color: TEXT_MUTED,
                  margin: 0,
                  lineHeight: "1.6",
                }}
              >
                {disclaimer ??
                  "This is an automated message from the Karatina University EDRMS. Please do not reply to this email — replies are not monitored. If you need help, contact your records office."}
              </Text>
            </Section>
          </Section>

          {/* Footer */}
          <Section style={{ padding: "20px 8px 0 8px" }}>
            <Text
              style={{
                fontSize: "11px",
                color: TEXT_MUTED,
                margin: "0 0 4px 0",
                textAlign: "center" as const,
                lineHeight: "1.6",
              }}
            >
              <strong style={{ color: KARU_GREEN }}>Karatina University</strong>
              <span style={{ color: "#9ca3af" }}> · </span>
              P.O. Box 1957-10101, Karatina
              <span style={{ color: "#9ca3af" }}> · </span>
              <Link
                href={baseUrl}
                style={{ color: KARU_GOLD, textDecoration: "underline" }}
              >
                edrms.karu.ac.ke
              </Link>
            </Text>
            <Text
              style={{
                fontSize: "11px",
                color: "#9ca3af",
                margin: 0,
                textAlign: "center" as const,
              }}
            >
              © {year} Karatina University. All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
