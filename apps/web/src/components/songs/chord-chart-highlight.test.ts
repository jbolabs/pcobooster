import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { highlightChordChart } from "@/components/songs/chord-chart-highlight";

const render = (text: string) =>
  renderToStaticMarkup(highlightChordChart(text, "chord"));

describe(highlightChordChart, () => {
  it("styles tagged lyrics, chords inside them included, and keeps the tags visible", () => {
    expect(render("<b>[G]Amazing</b> grace")).toBe(
      '<span><span class="text-muted-foreground">&lt;b&gt;</span><span class="faux-bold"><span class="chord faux-bold">[G]</span>Amazing</span><span class="text-muted-foreground">&lt;/b&gt;</span> grace</span>'
    );
  });

  it("nests italic inside bold", () => {
    expect(render("<b><i>x</i></b>")).toBe(
      '<span><span class="text-muted-foreground">&lt;b&gt;</span><span class="faux-bold"><span class="text-muted-foreground">&lt;i&gt;</span><span class="inline-block -skew-x-12">x</span><span class="text-muted-foreground">&lt;/i&gt;</span></span><span class="text-muted-foreground">&lt;/b&gt;</span></span>'
    );
  });
});
