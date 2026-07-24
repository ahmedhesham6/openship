import { RootProvider } from "fumadocs-ui/provider/next";
import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import { docsSource } from "@/lib/source";
import type { ReactNode } from "react";

// fumadocs-ui/style.css is imported once in the (docs) ROOT layout so the
// stylesheet is confined to the docs document (see (docs)/layout.tsx).

/**
 * Native Fumadocs "Notebook" docs shell — full-width navbar on top (like
 * fumadocs.dev), sidebar + TOC below. RootProvider is scoped to /docs so the
 * light-only marketing site is untouched, while docs get the full native
 * experience: light/dark theme + toggle, native search (/api/search), sidebar,
 * TOC. No custom theming — stock Fumadocs.
 */
export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    <RootProvider theme={{ defaultTheme: "light", enableSystem: false }}>
      <DocsLayout
        tree={docsSource.pageTree}
        nav={{
          mode: "top",
          title: (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/apple-touch-icon.png"
                alt=""
                className="inline-block h-[22px] w-[22px] shrink-0 rounded-md object-cover"
              />
              <span className="font-semibold">Openship</span>
            </>
          ),
          url: "/",
        }}
        githubUrl="https://github.com/oblien/openship"
        links={[
          { text: "Changelog", url: "/changelog" },
          { text: "Resources", url: "/resources" },
        ]}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
