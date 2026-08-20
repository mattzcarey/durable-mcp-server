import { Link, Text } from "@cloudflare/kumo";
import { COPY, REPO_URL, SPEC_URL } from "../lib/copy";

/** The line under main: the spec this page speaks, and the code that speaks it. */
export function Footer() {
  return (
    <footer className="px-5 py-3 border-t border-kumo-line">
      <div className="max-w-5xl mx-auto">
        <Text size="xs" variant="secondary">
          {COPY.footerBefore}
          <Link href={SPEC_URL} target="_blank" rel="noopener noreferrer">
            {COPY.footerLink}
          </Link>
          {COPY.footerAfter}
          <Link href={REPO_URL} target="_blank" rel="noopener noreferrer">
            {COPY.footerRepoLink}
          </Link>
          {COPY.footerRepoAfter}
        </Text>
      </div>
    </footer>
  );
}
