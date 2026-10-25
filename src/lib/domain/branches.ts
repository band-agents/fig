/**
 * The shops a customer can bring a return to, or collect cash from.
 *
 * Returns to a branch only work if the customer is told which branches exist, so this is the list
 * the portal shows the moment they choose to come in person. It is kept here, with the policies and
 * the stages, rather than in the database: a shop opening or closing is a change to the business
 * that should arrive as a change to the code, reviewed, and not as a row someone edited at night.
 *
 * **The list is the client's to give.** Nothing here may be guessed: a wrong address sends someone
 * across town with a parcel. The Kuwait shops below are transcribed from the store list Dagher &
 * Co's office sent on 8 October 2026 — mall, brand, and the counter's own telephone number, with
 * no district or opening hours invented around them. Where a market's list has not been handed over
 * the list is empty, and the portal says plainly that customer care will arrange which shop.
 */

export type Branch = {
  /** Stable, and stored on the return, so renaming the shop later does not rewrite history. */
  id: string;
  name: string;
  /** The mall or district, as a customer would say it. */
  area: string;
  address: string;
  phone?: string;
  hours?: string;
  /**
   * The brands sold over this counter.
   *
   * Kuwait returns go to the brand's own shop rather than to a general one, so a customer sending
   * back an Etam dress is shown the Etam counters and not the twenty-six others. Empty means the
   * shop takes anything.
   */
  brands?: string[];
};

/** Every D&H and D&Co counter in Kuwait, by mall. Labesny sells all of these online. */
const KUWAIT: Branch[] = [
  { id: "ws-360", name: "Women Secret · 360 Mall", area: "360 Mall", address: "360 Mall, Kuwait", phone: "+965 50669505", brands: ["Women Secret"] },
  { id: "etam-360", name: "Etam · 360 Mall", area: "360 Mall", address: "360 Mall, Kuwait", phone: "+965 55286520", brands: ["Etam"] },
  { id: "lavieenrose-360", name: "La Vie en Rose · 360 Mall", area: "360 Mall", address: "360 Mall, Kuwait", phone: "+965 55157110", brands: ["La Vie en Rose"] },
  { id: "bimbaylola-360", name: "Bimba Y Lola · 360 Mall", area: "360 Mall", address: "360 Mall, Kuwait", phone: "+965 55158744", brands: ["Bimba Y Lola"] },
  { id: "ws-avenues", name: "Women Secret · Avenues Mall", area: "Avenues Mall", address: "Avenues Mall, Kuwait", phone: "+965 22597266", brands: ["Women Secret"] },
  { id: "etam-avenues", name: "Etam · Avenues Mall", area: "Avenues Mall", address: "Avenues Mall, Kuwait", phone: "+965 22597272", brands: ["Etam"] },
  { id: "yamamay-avenues", name: "Yamamay · Avenues Mall", area: "Avenues Mall", address: "Avenues Mall, Kuwait", phone: "+965 22597349", brands: ["Yamamay"] },
  { id: "lavieenrose-avenues", name: "La Vie en Rose · Avenues Mall", area: "Avenues Mall", address: "Avenues Mall, Kuwait", phone: "+965 22200646", brands: ["La Vie en Rose"] },
  { id: "bimbaylola-avenues", name: "Bimba Y Lola · Avenues Mall", area: "Avenues Mall", address: "Avenues Mall, Kuwait", phone: "+965 22200647", brands: ["Bimba Y Lola"] },
  { id: "hunkemoller-avenues", name: "Hunkemoller · Avenues Mall", area: "Avenues Mall", address: "Avenues Mall, Kuwait", phone: "+965 50335045", brands: ["Hunkemoller"] },
  { id: "ws-gate", name: "Women Secret · Gate Mall", area: "Gate Mall", address: "Gate Mall, Kuwait", phone: "+965 50366943", brands: ["Women Secret"] },
  { id: "etam-gate", name: "Etam · Gate Mall", area: "Gate Mall", address: "Gate Mall, Kuwait", phone: "+965 50133438", brands: ["Etam"] },
  { id: "lavieenrose-gate", name: "La Vie en Rose · Gate Mall", area: "Gate Mall", address: "Gate Mall, Kuwait", phone: "+965 50986558", brands: ["La Vie en Rose"] },
  { id: "ws-mohalab", name: "Women Secret · Mohalab Mall", area: "Mohalab Mall", address: "Mohalab Mall, Kuwait", phone: "+965 22634711", brands: ["Women Secret"] },
  { id: "tomtailor-mohalab", name: "Tom Tailor · Mohalab Mall", area: "Mohalab Mall", address: "Mohalab Mall, Kuwait", phone: "+965 22634785", brands: ["Tom Tailor"] },
  { id: "benetton-mohala", name: "Benetton · Mohalab Mall", area: "Mohalab Mall", address: "Mohalab Mall, Kuwait", phone: "+965 22634691", brands: ["Benetton"] },
  { id: "bimbaylola-mohalab", name: "Bimba Y Lola · Mohalab Mall", area: "Mohalab Mall", address: "Mohalab Mall, Kuwait", phone: "+965 22661352", brands: ["Bimba Y Lola"] },
  { id: "lavieenrose-mohalab", name: "La Vie en Rose · Mohalab Mall", area: "Mohalab Mall", address: "Mohalab Mall, Kuwait", phone: "+965 22634129", brands: ["La Vie en Rose"] },
  { id: "ws-kout", name: "Women Secret · Al Kout Mall", area: "Al Kout Mall", address: "Al Kout Mall, Kuwait", phone: "+965 60702662", brands: ["Women Secret"] },
  { id: "yamamay-kout", name: "Yamamay · Al Kout Mall", area: "Al Kout Mall", address: "Al Kout Mall, Kuwait", phone: "+965 50149361", brands: ["Yamamay"] },
  { id: "bimbaylola-alkout", name: "Bimba Y Lola · Al Kout Mall", area: "Al Kout Mall", address: "Al Kout Mall, Kuwait", phone: "+965 60709939", brands: ["Bimba Y Lola"] },
  { id: "lavieenrose-alkout", name: "La Vie en Rose · Al Kout Mall", area: "Al Kout Mall", address: "Al Kout Mall, Kuwait", phone: "+965 60706601", brands: ["La Vie en Rose"] },
  { id: "etam-marina", name: "Etam · Marina Mall", area: "Marina Mall", address: "Marina Mall, Kuwait", phone: "+965 60702442", brands: ["Etam"] },
  { id: "celio-marina", name: "Celio · Marina Mall", area: "Marina Mall", address: "Marina Mall, Kuwait", phone: "+965 60702208", brands: ["Celio"] },
  { id: "etam-w-m", name: "Etam · Warehouse Mall", area: "Warehouse Mall", address: "Warehouse Mall, Kuwait", phone: "+965 56575202", brands: ["Etam"] },
  { id: "hunkemoller-w-m", name: "Hunkemoller · Warehouse Mall", area: "Warehouse Mall", address: "Warehouse Mall, Kuwait", phone: "+965 50223874", brands: ["Hunkemoller"] },
  { id: "lavieenrose-alraya", name: "La Vie en Rose · Araya Mall", area: "Araya Mall", address: "Araya Mall, Kuwait", phone: "+965 55367752", brands: ["La Vie en Rose"] },
];

/**
 * Keyed by brand and country, because branches belong to a shop on a street and not to a website:
 * an order from the Labesny app comes back to the same Kuwait shops as one from labesny.com.
 */
const BY_MARKET: Record<string, Branch[]> = {
  /* Labesny sells every one of these brands online, so every counter takes its returns. */
  'Labesny:KW': KUWAIT,
  /* The Women'secret storefront's own shops: the five counters that carry the brand. */
  "Women'secret:KW": KUWAIT.filter((b) => b.brands?.some((x) => x === 'Women Secret')),

  /* Egypt and Jordan: not handed over yet. */
  'FIG:EG': [],
  "Women'secret:EG": [],
  "Women'secret:JO": [],
};

/** Every branch a customer of this brand and country may use. Empty when the list is not in yet. */
export function branchesFor(brand: string, country: string): Branch[] {
  return BY_MARKET[`${brand}:${country}`] ?? [];
}

/**
 * Compares two spellings of a brand.
 *
 * The store list says "Women Secret" and "Benetton"; the catalogue says "WOMEN'SECRET" and
 * "UNITED COLORS OF BENETTON". Folding away everything but the letters, and letting either contain
 * the other, is what makes those the same shop.
 */
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export function sameBrand(a: string, b: string): boolean {
  const [x, y] = [fold(a), fold(b)];
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * The shops that can take this particular return.
 *
 * A customer sending back an Etam dress is shown the Etam counters, and only those: a shop that does
 * not sell the brand cannot take it back. When nothing matches — bebe and Springfield sell on
 * Labesny but have no Kuwait counter of their own — the list is empty, the portal says the desk will
 * tell them where to bring it, and the desk settles it on approval.
 */
export function branchesForReturn(brand: string, country: string, itemBrands: string[]): Branch[] {
  const all = branchesFor(brand, country);
  if (!itemBrands.length) return all;
  const matching = all.filter((b) => !b.brands?.length || b.brands.some((x) => itemBrands.some((i) => sameBrand(x, i))));
  return matching;
}

/** The chosen branch, or null when it is not one this customer may pick. */
export function findBranch(brand: string, country: string, id: string | null | undefined): Branch | null {
  if (!id) return null;
  return branchesFor(brand, country).find((b) => b.id === id) ?? null;
}

/** Whether the customer has to choose one. False while a market's list is still empty. */
export const branchChoiceRequired = (brand: string, country: string) => branchesFor(brand, country).length > 0;
