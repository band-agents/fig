// Fictional people and places for demo data. Nobody here is a real customer or employee.
import type { Role } from '../lib/domain/perms';

/** Shifts are minutes after local midnight; rest days 0 = Sunday … 5 = Friday, 6 = Saturday. */
export type DemoPerson = { email: string; name: string; title: string; role: Role; channels?: string[]; hue: number; location?: string; shift?: [number, number]; rest?: number[]; skills?: string[] };

const EG = ['fig-web', 'fig-app', 'fig-woo', 'ws-eg'];
const KW = ['labesny-web', 'labesny-app', 'ws-kw'];
const OFFICE = [5, 6];

export const DEMO_STAFF: DemoPerson[] = [
  { email: 'admin@relay.local', name: 'DH & DCO Admin', title: 'Owner', role: 'admin', hue: 2 },
  { email: 'nour@relay.local', name: 'Nour Hassan', title: 'Head of Operations', role: 'ops', hue: 262, shift: [540, 1080], rest: OFFICE },
  { email: 'hala@relay.local', name: 'Hala Barakat', title: 'Head of supply chain', role: 'supply', hue: 24, location: 'dh-kuwait', shift: [540, 1020], rest: OFFICE },
  { email: 'dana@relay.local', name: 'Dana Al-Mutairi', title: 'Stock planner · Kuwait', role: 'planner', hue: 168, location: 'dh-kuwait', shift: [540, 1020], rest: OFFICE, skills: ['po_review'] },
  { email: 'tarek@relay.local', name: 'Tarek Nabil', title: 'Buyer · Egypt', role: 'buyer', channels: EG, hue: 48, location: 'fig-cairo', shift: [540, 1020], rest: OFFICE, skills: ['supplier_followup', 'po_review'] },
  { email: 'noura@relay.local', name: 'Noura Behbehani', title: 'Buyer · Kuwait', role: 'buyer', channels: KW, hue: 330, location: 'dh-kuwait', shift: [540, 1020], rest: OFFICE, skills: ['supplier_followup', 'po_review'] },
  { email: 'maya@relay.local', name: 'Maya Haddad', title: 'E-commerce merchandiser', role: 'merchandiser', hue: 310, shift: [600, 1080], rest: OFFICE, skills: ['merch_setup'] },
  { email: 'salma@relay.local', name: 'Salma Adel', title: 'Customer care', role: 'care', channels: EG, hue: 286 },
  { email: 'youssef@relay.local', name: 'Youssef Kamal', title: 'Customer care', role: 'care', channels: EG, hue: 300 },
  { email: 'mariam@relay.local', name: 'Mariam Fawzy', title: 'Finance', role: 'finance', hue: 40 },
  { email: 'omar@relay.local', name: 'Omar Saeed', title: 'Warehouse lead · Cairo', role: 'fulfilment', channels: EG, hue: 214, location: 'fig-cairo', shift: [540, 1080], rest: [5], skills: ['receive', 'quality_check'] },
  { email: 'karim@relay.local', name: 'Karim Lotfy', title: 'Picker · Cairo', role: 'fulfilment', channels: EG, hue: 200, location: 'fig-cairo', shift: [780, 1260], rest: [5], skills: ['transfer_pick', 'replenish'] },
  { email: 'mahmoud@relay.local', name: 'Mahmoud Ragab', title: 'Warehouse · Cairo', role: 'warehouse', channels: EG, hue: 190, location: 'fig-cairo', shift: [600, 1140], rest: [5], skills: ['putaway', 'cycle_count'] },
  { email: 'sherif@relay.local', name: 'Sherif Adel', title: 'Store operations · Cairo', role: 'warehouse', channels: EG, hue: 236, shift: [660, 1200], rest: [5], skills: ['transfer_receive', 'relabel', 'cycle_count'] },
  { email: 'hady@relay.local', name: 'Hady Mansour', title: 'Shipping', role: 'shipping', hue: 186 },
  { email: 'rana@relay.local', name: 'Rana Samir', title: 'Returns desk', role: 'returns', hue: 340 },
  { email: 'fatma@relay.local', name: 'Fatma Al-Enezi', title: 'Warehouse lead · Kuwait', role: 'fulfilment', channels: KW, hue: 222, location: 'dh-kuwait', shift: [480, 960], rest: [5], skills: ['receive', 'quality_check'] },
  { email: 'joel@relay.local', name: 'Joel Santos', title: 'Warehouse · Kuwait', role: 'warehouse', channels: KW, hue: 205, location: 'dh-kuwait', shift: [480, 960], rest: [5], skills: ['putaway', 'replenish'] },
  { email: 'ramesh@relay.local', name: 'Ramesh Nair', title: 'Warehouse · Kuwait (evening)', role: 'warehouse', channels: KW, hue: 160, location: 'dh-kuwait', shift: [840, 1320], rest: [5], skills: ['transfer_pick', 'cycle_count'] },
  { email: 'dalal@relay.local', name: 'Dalal Al-Kandari', title: 'Store operations · Kuwait', role: 'warehouse', channels: KW, hue: 280, shift: [600, 1140], rest: [5], skills: ['transfer_receive', 'relabel', 'cycle_count'] },
  { email: 'abdullah@relay.local', name: 'Abdullah Al-Rashidi', title: 'Customer care · Kuwait', role: 'care', channels: KW, hue: 270 },
  { email: 'laila@relay.local', name: 'Laila Mostafa', title: 'Marketing', role: 'marketing', hue: 150 },
];

export const EG_FIRST_F = ['Salma', 'Nour', 'Mariam', 'Habiba', 'Farida', 'Malak', 'Jana', 'Hana', 'Yasmin', 'Aya', 'Dina', 'Rana', 'Mona', 'Heba', 'Nada', 'Reem', 'Sara', 'Laila', 'Rania', 'Shahd', 'Menna', 'Esraa', 'Noha', 'Ghada', 'Amira', 'Doaa', 'Marwa', 'Basma', 'Nesma', 'Omnia', 'Hagar', 'Rawan', 'Logy', 'Nadine', 'Carmen', 'Mirna'];
export const EG_FIRST_M = ['Ahmed', 'Mohamed', 'Omar', 'Youssef', 'Karim', 'Mostafa', 'Ali', 'Hassan', 'Tarek', 'Amr', 'Khaled', 'Sherif', 'Hossam', 'Mahmoud', 'Ibrahim', 'Seif', 'Marwan', 'Ziad'];
export const EG_LAST = ['Hassan', 'Mostafa', 'Adel', 'Fawzy', 'Kamal', 'Samir', 'Lotfy', 'Mansour', 'Saeed', 'Gamal', 'Farouk', 'Nabil', 'Hamdy', 'Salah', 'Zaki', 'El-Sayed', 'Abdelrahman', 'Shawky', 'Ragab', 'Helmy', 'Ezzat', 'Fathy', 'Soliman', 'Hegazy', 'Badawy', 'Naguib', 'Wahba', 'Tawfik', 'Rizk', 'Hanna'];
export const KW_FIRST_F = ['Fatma', 'Noura', 'Dana', 'Lulwa', 'Shaikha', 'Haya', 'Maryam', 'Ghala', 'Fajer', 'Sara', 'Reem', 'Alanoud', 'Dalal', 'Hessa', 'Bibi', 'Ghadeer', 'Jood', 'Latifa'];
export const KW_FIRST_M = ['Abdullah', 'Mohammed', 'Fahad', 'Khalid', 'Yousef', 'Bader', 'Saud', 'Meshari', 'Hamad'];
export const KW_LAST = ['Al-Enezi', 'Al-Rashidi', 'Al-Mutairi', 'Al-Ajmi', 'Al-Shammari', 'Al-Kandari', 'Al-Hajri', 'Al-Azmi', 'Al-Otaibi', 'Al-Dosari', 'Behbehani', 'Al-Saleh', 'Al-Fadhli', 'Al-Qattan', 'Al-Kharafi', 'Dashti'];

// weight = share of orders; rto = how often COD parcels get refused there (drives a learnable pattern)
export const EG_PLACES: { region: string; cities: string[]; weight: number; rto: number }[] = [
  { region: 'Cairo', cities: ['Nasr City', 'Maadi', 'Heliopolis', 'New Cairo', 'Zamalek', 'Mokattam', 'Shubra', 'Downtown', 'El Rehab', 'Madinaty'], weight: 34, rto: 0.06 },
  { region: 'Giza', cities: ['Dokki', 'Mohandessin', 'Sheikh Zayed', '6th of October', 'Haram', 'Agouza', 'Faisal'], weight: 20, rto: 0.08 },
  { region: 'Alexandria', cities: ['Smouha', 'Sidi Gaber', 'Miami', 'Gleem', 'Stanley', 'Louran'], weight: 13, rto: 0.09 },
  { region: 'Dakahlia', cities: ['Mansoura', 'Talkha'], weight: 4, rto: 0.13 },
  { region: 'Gharbia', cities: ['Tanta', 'El Mahalla'], weight: 3, rto: 0.12 },
  { region: 'Sharqia', cities: ['Zagazig', '10th of Ramadan'], weight: 3, rto: 0.14 },
  { region: 'Qalyubia', cities: ['Banha', 'Shubra El Kheima', 'Obour'], weight: 4, rto: 0.11 },
  { region: 'Red Sea', cities: ['Hurghada', 'El Gouna'], weight: 2, rto: 0.07 },
  { region: 'Ismailia', cities: ['Ismailia'], weight: 1.5, rto: 0.1 },
  { region: 'Port Said', cities: ['Port Said'], weight: 1.5, rto: 0.1 },
  { region: 'Suez', cities: ['Suez'], weight: 1, rto: 0.11 },
  { region: 'Minya', cities: ['Minya', 'Mallawi'], weight: 2, rto: 0.24 },
  { region: 'Assiut', cities: ['Assiut'], weight: 2, rto: 0.27 },
  { region: 'Sohag', cities: ['Sohag', 'Akhmim'], weight: 1.5, rto: 0.29 },
  { region: 'Luxor', cities: ['Luxor'], weight: 1, rto: 0.18 },
  { region: 'Aswan', cities: ['Aswan'], weight: 1, rto: 0.2 },
  { region: 'Beheira', cities: ['Damanhour'], weight: 1.5, rto: 0.15 },
  { region: 'Monufia', cities: ['Shebin El Kom'], weight: 1.5, rto: 0.14 },
  { region: 'Damietta', cities: ['Damietta', 'New Damietta'], weight: 1, rto: 0.12 },
  { region: 'Fayoum', cities: ['Fayoum'], weight: 1, rto: 0.21 },
];

export const KW_PLACES: { region: string; cities: string[]; weight: number; rto: number }[] = [
  { region: 'Hawalli', cities: ['Salmiya', 'Hawalli', 'Jabriya', 'Rumaithiya', 'Mishref', 'Salwa'], weight: 38, rto: 0.02 },
  { region: 'Capital', cities: ['Kuwait City', 'Shuwaikh', 'Kaifan', 'Yarmouk', 'Surra'], weight: 22, rto: 0.02 },
  { region: 'Farwaniya', cities: ['Farwaniya', 'Khaitan', 'Ardiya'], weight: 14, rto: 0.03 },
  { region: 'Ahmadi', cities: ['Fintas', 'Mangaf', 'Mahboula', 'Fahaheel'], weight: 14, rto: 0.03 },
  { region: 'Mubarak Al-Kabeer', cities: ['Sabah Al-Salem', 'Mubarak Al-Kabeer', 'Qurain'], weight: 7, rto: 0.03 },
  { region: 'Jahra', cities: ['Jahra', 'Saad Al Abdullah'], weight: 5, rto: 0.04 },
];

export const EG_STREETS = ['Abbas El Akkad St', 'Makram Ebeid St', 'Gameat El Dowal St', 'El Tahrir St', 'Road 9', 'El Nozha St', 'Mostafa El Nahas St', 'El Thawra St', '90th St', 'Shehab St', 'Syria St', 'El Haram St', 'Port Said St', 'Fouad St', 'El Geish Rd', 'Corniche Rd'];
export const KW_STREETS = ['Salem Al Mubarak St', 'Tunis St', 'Baghdad St', 'Gulf Rd', 'Fourth Ring Rd', 'Abu Bakr Al Siddiq St', 'Amman St'];
