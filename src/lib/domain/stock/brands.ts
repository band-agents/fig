// Which company a brand belongs to in Kuwait. D&Co carries La Vie en Rose, Hunkemöller, Bebe and
// Bimba Y Lola; everything else Labesny sells is D&H's. Pure.

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const DCO = ['La Vie en Rose', 'Hunkemoller', 'Bimba Y Lola', 'Bebe'];

export const companyOfBrand = (brand: string): 'DH' | 'DCO' => (DCO.some((b) => fold(b).includes(fold(brand)) || fold(brand).includes(fold(b))) && fold(brand).length > 2 ? 'DCO' : 'DH');
