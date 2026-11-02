export interface ScanBadgeInfo {
  publicId: string;
  status: string;
  count: number;
  contacts: number;
  createdAt: string;
  keyword: string | null;
  assignedTo?: string | null;
}

export interface TamanLocation {
  name: string;
  queryPlace: string;
  scan?: ScanBadgeInfo | null;
  // Best scan per search keyword ('business', 'factory', ...) at this taman,
  // so a bulk scan can tell which keywords still need running.
  scanByKeyword?: Record<string, ScanBadgeInfo>;
  // Leads at this taman still waiting for contact research.
  contactPending?: number;
  assignedTo?: string | null;
}

export interface TownLocation {
  id: string;
  name: string;
  fullName: string;
  queryPlace: string;
  scan?: ScanBadgeInfo | null;
  tamans: TamanLocation[];
}

export interface DistrictLocation {
  id: string;
  num: number;
  name: string;
  state: string;
  totalTamans?: number;
  scannedTamans?: number;
  towns: TownLocation[];
}

export interface StateTerritory {
  state: string;
  districts: DistrictLocation[];
}

export const JOHOR_TERRITORY: StateTerritory = {
  state: 'Johor',
  districts: [
  {
    "id": "johor_johor_bahru",
    "num": 1,
    "name": "Johor Bahru",
    "state": "Johor",
    "towns": [
      {
        "id": "johor_johor_bahru_johor_bahru_city_centre",
        "name": "Johor Bahru City Centre",
        "fullName": "Johor Bahru City Centre & Inner Suburbs (MBJB)",
        "queryPlace": "Johor Bahru City Centre, Johor Bahru, Johor",
        "tamans": [
          {
            "name": "Wadi Hana / Bukit Chagar / Tanjung Puteri",
            "queryPlace": "Wadi Hana / Bukit Chagar / Tanjung Puteri, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Taman Pelangi",
            "queryPlace": "Taman Pelangi, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Taman Century (Taman Abad)",
            "queryPlace": "Taman Century, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Taman Sentosa",
            "queryPlace": "Taman Sentosa, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Taman Sri Tebrau",
            "queryPlace": "Taman Sri Tebrau, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Taman Melodies",
            "queryPlace": "Taman Melodies, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Taman Serene",
            "queryPlace": "Taman Serene, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Taman Kebun Teh",
            "queryPlace": "Taman Kebun Teh, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Taman Kolam Air",
            "queryPlace": "Taman Kolam Air, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Taman Nong Chik",
            "queryPlace": "Taman Nong Chik, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Taman Straits View",
            "queryPlace": "Taman Straits View, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Taman Majidee",
            "queryPlace": "Taman Majidee, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Kampung Melayu Majidee",
            "queryPlace": "Kampung Melayu Majidee, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Stulang Laut & Stulang Darat",
            "queryPlace": "Stulang Laut & Stulang Darat, Johor Bahru City Centre, Johor"
          },
          {
            "name": "Country Garden Danga Bay",
            "queryPlace": "Country Garden Danga Bay, Johor Bahru City Centre, Johor"
          }
        ]
      },
      {
        "id": "johor_johor_bahru_tebrau",
        "name": "Tebrau",
        "fullName": "Tebrau & Mount Austin Corridor (MBJB)",
        "queryPlace": "Tebrau, Johor Bahru, Johor",
        "tamans": [
          {
            "name": "Taman Mount Austin",
            "queryPlace": "Taman Mount Austin, Tebrau, Johor"
          },
          {
            "name": "Austin Heights",
            "queryPlace": "Austin Heights, Tebrau, Johor"
          },
          {
            "name": "Austin Perdana",
            "queryPlace": "Austin Perdana, Tebrau, Johor"
          },
          {
            "name": "Austin Crest",
            "queryPlace": "Austin Crest, Tebrau, Johor"
          },
          {
            "name": "Austin Duta",
            "queryPlace": "Austin Duta, Tebrau, Johor"
          },
          {
            "name": "Crest @ Austin",
            "queryPlace": "Crest @ Austin, Tebrau, Johor"
          },
          {
            "name": "Taman Desa Tebrau",
            "queryPlace": "Taman Desa Tebrau, Tebrau, Johor"
          },
          {
            "name": "Taman Daya",
            "queryPlace": "Taman Daya, Tebrau, Johor"
          },
          {
            "name": "Taman Delima",
            "queryPlace": "Taman Delima, Tebrau, Johor"
          },
          {
            "name": "Bandar Dato' Onn",
            "queryPlace": "Bandar Dato' Onn, Tebrau, Johor"
          },
          {
            "name": "Taman Adda Heights",
            "queryPlace": "Taman Adda Heights, Tebrau, Johor"
          },
          {
            "name": "Taman Seri Austin",
            "queryPlace": "Taman Seri Austin, Tebrau, Johor"
          },
          {
            "name": "Taman Setia Indah",
            "queryPlace": "Taman Setia Indah, Tebrau, Johor"
          },
          {
            "name": "Eco Summer",
            "queryPlace": "Eco Summer, Tebrau, Johor"
          },
          {
            "name": "Eco Spring",
            "queryPlace": "Eco Spring, Tebrau, Johor"
          },
          {
            "name": "Eco Cascadia",
            "queryPlace": "Eco Cascadia, Tebrau, Johor"
          },
          {
            "name": "Bandar Jaya Putra (JP Perdana)",
            "queryPlace": "Bandar Jaya Putra, Tebrau, Johor"
          },
          {
            "name": "Taman Glenmarie Johor Bahru",
            "queryPlace": "Taman Glenmarie Johor Bahru, Tebrau, Johor"
          }
        ]
      },
      {
        "id": "johor_johor_bahru_johor_jaya",
        "name": "Johor Jaya",
        "fullName": "Johor Jaya & Plentong Corridor (MBJB / MBPG)",
        "queryPlace": "Johor Jaya, Johor Bahru, Johor",
        "tamans": [
          {
            "name": "Taman Johor Jaya",
            "queryPlace": "Taman Johor Jaya, Johor Jaya, Johor"
          },
          {
            "name": "Jalan Dedap",
            "queryPlace": "Jalan Dedap, Johor Jaya, Johor"
          },
          {
            "name": "Jalan Ros Merah",
            "queryPlace": "Jalan Ros Merah, Johor Jaya, Johor"
          },
          {
            "name": "Jalan Keembong",
            "queryPlace": "Jalan Keembong, Johor Jaya, Johor"
          },
          {
            "name": "Jalan Teratai",
            "queryPlace": "Jalan Teratai, Johor Jaya, Johor"
          },
          {
            "name": "Jalan Anggerik",
            "queryPlace": "Jalan Anggerik, Johor Jaya, Johor"
          },
          {
            "name": "Jalan Bakawali",
            "queryPlace": "Jalan Bakawali, Johor Jaya, Johor"
          },
          {
            "name": "Taman Molek",
            "queryPlace": "Taman Molek, Johor Jaya, Johor"
          },
          {
            "name": "Taman Redang",
            "queryPlace": "Taman Redang, Johor Jaya, Johor"
          },
          {
            "name": "Taman Ponderosa",
            "queryPlace": "Taman Ponderosa, Johor Jaya, Johor"
          },
          {
            "name": "Taman Saujana (Plentong)",
            "queryPlace": "Taman Saujana, Johor Jaya, Johor"
          },
          {
            "name": "Taman Desa Harmoni",
            "queryPlace": "Taman Desa Harmoni, Johor Jaya, Johor"
          },
          {
            "name": "Taman Sri Plentong",
            "queryPlace": "Taman Sri Plentong, Johor Jaya, Johor"
          },
          {
            "name": "Taman Plentong Baru",
            "queryPlace": "Taman Plentong Baru, Johor Jaya, Johor"
          },
          {
            "name": "Taman Ria Plentong",
            "queryPlace": "Taman Ria Plentong, Johor Jaya, Johor"
          },
          {
            "name": "Bandar Baru Permas Jaya",
            "queryPlace": "Bandar Baru Permas Jaya, Johor Jaya, Johor"
          },
          {
            "name": "Senibong Cove",
            "queryPlace": "Senibong Cove, Johor Jaya, Johor"
          }
        ]
      },
      {
        "id": "johor_johor_bahru_ulu_tiram",
        "name": "Ulu Tiram",
        "fullName": "Ulu Tiram & Tebrau North (MBJB)",
        "queryPlace": "Ulu Tiram, Johor Bahru, Johor",
        "tamans": [
          {
            "name": "Bandar Tiram",
            "queryPlace": "Bandar Tiram, Ulu Tiram, Johor"
          },
          {
            "name": "Taman Pelangi Indah",
            "queryPlace": "Taman Pelangi Indah, Ulu Tiram, Johor"
          },
          {
            "name": "Taman Puteri Wangsa",
            "queryPlace": "Taman Puteri Wangsa, Ulu Tiram, Johor"
          },
          {
            "name": "Taman Gaya",
            "queryPlace": "Taman Gaya, Ulu Tiram, Johor"
          },
          {
            "name": "Taman Desa Cemerlang",
            "queryPlace": "Taman Desa Cemerlang, Ulu Tiram, Johor"
          },
          {
            "name": "Taman Bestari Indah",
            "queryPlace": "Taman Bestari Indah, Ulu Tiram, Johor"
          },
          {
            "name": "Taman Bukit Jaya",
            "queryPlace": "Taman Bukit Jaya, Ulu Tiram, Johor"
          },
          {
            "name": "Taman Tiram Baru",
            "queryPlace": "Taman Tiram Baru, Ulu Tiram, Johor"
          },
          {
            "name": "Taman Nora",
            "queryPlace": "Taman Nora, Ulu Tiram, Johor"
          },
          {
            "name": "Taman Zamrud",
            "queryPlace": "Taman Zamrud, Ulu Tiram, Johor"
          },
          {
            "name": "Taman Berlian",
            "queryPlace": "Taman Berlian, Ulu Tiram, Johor"
          },
          {
            "name": "Taman Mutiara Tropika",
            "queryPlace": "Taman Mutiara Tropika, Ulu Tiram, Johor"
          }
        ]
      },
      {
        "id": "johor_johor_bahru_tampoi_kempas",
        "name": "Tampoi, Kempas",
        "fullName": "Tampoi, Kempas & Larkin (MBJB)",
        "queryPlace": "Tampoi, Kempas, Johor Bahru, Johor",
        "tamans": [
          {
            "name": "Taman Larkin Perdana",
            "queryPlace": "Taman Larkin Perdana, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Dato' Onn Jaafar",
            "queryPlace": "Taman Dato' Onn Jaafar, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Idaman Larkin",
            "queryPlace": "Taman Idaman Larkin, Tampoi, Kempas, Johor"
          },
          {
            "name": "Larkin Sentral Area",
            "queryPlace": "Larkin Sentral Area, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Suria (Tampoi/Larkin)",
            "queryPlace": "Taman Suria, Tampoi, Kempas, Johor"
          },
          {
            "name": "Bandar Baru UDA (BBU)",
            "queryPlace": "Bandar Baru UDA, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Tampoi Indah (1 & 2)",
            "queryPlace": "Taman Tampoi Indah, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Tampoi Utama",
            "queryPlace": "Taman Tampoi Utama, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Dahlia",
            "queryPlace": "Taman Dahlia, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Kobena",
            "queryPlace": "Taman Kobena, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Kemas",
            "queryPlace": "Taman Kemas, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Skudai Kanan / Kiri",
            "queryPlace": "Taman Skudai Kanan / Kiri, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Damansara Aliff (Aliff Oval)",
            "queryPlace": "Taman Damansara Aliff, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Angsana",
            "queryPlace": "Taman Angsana, Tampoi, Kempas, Johor"
          },
          {
            "name": "Kempas Denai",
            "queryPlace": "Kempas Denai, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Kempas Indah",
            "queryPlace": "Taman Kempas Indah, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Kempas Utama",
            "queryPlace": "Taman Kempas Utama, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Sinaran Kempas",
            "queryPlace": "Taman Sinaran Kempas, Tampoi, Kempas, Johor"
          },
          {
            "name": "Taman Setia Tropika",
            "queryPlace": "Taman Setia Tropika, Tampoi, Kempas, Johor"
          }
        ]
      },
      {
        "id": "johor_johor_bahru_iskandar_puteri",
        "name": "Iskandar Puteri",
        "fullName": "Iskandar Puteri Core & Medini (MBIP)",
        "queryPlace": "Iskandar Puteri, Johor Bahru, Johor",
        "tamans": [
          {
            "name": "Kota Iskandar",
            "queryPlace": "Kota Iskandar, Iskandar Puteri, Johor"
          },
          {
            "name": "Puteri Harbour",
            "queryPlace": "Puteri Harbour, Iskandar Puteri, Johor"
          },
          {
            "name": "Medini Iskandar",
            "queryPlace": "Medini Iskandar, Iskandar Puteri, Johor"
          },
          {
            "name": "Sunway City Iskandar Puteri",
            "queryPlace": "Sunway City Iskandar Puteri, Iskandar Puteri, Johor"
          },
          {
            "name": "Eco Botanic (Eco Botanic 1 & 2)",
            "queryPlace": "Eco Botanic, Iskandar Puteri, Johor"
          },
          {
            "name": "Horizon Hills",
            "queryPlace": "Horizon Hills, Iskandar Puteri, Johor"
          },
          {
            "name": "East Ledang",
            "queryPlace": "East Ledang, Iskandar Puteri, Johor"
          },
          {
            "name": "Ledang Heights",
            "queryPlace": "Ledang Heights, Iskandar Puteri, Johor"
          },
          {
            "name": "Leisure Farm Resort",
            "queryPlace": "Leisure Farm Resort, Iskandar Puteri, Johor"
          }
        ]
      },
      {
        "id": "johor_johor_bahru_bukit_indah_perling",
        "name": "Bukit Indah, Perling",
        "fullName": "Bukit Indah, Perling & Sutera (MBIP)",
        "queryPlace": "Bukit Indah, Perling, Johor Bahru, Johor",
        "tamans": [
          {
            "name": "Taman Bukit Indah (Bukit Indah 1 & 2)",
            "queryPlace": "Taman Bukit Indah, Bukit Indah, Perling, Johor"
          },
          {
            "name": "Taman Perling",
            "queryPlace": "Taman Perling, Bukit Indah, Perling, Johor"
          },
          {
            "name": "Taman Baiduri",
            "queryPlace": "Taman Baiduri, Bukit Indah, Perling, Johor"
          },
          {
            "name": "Taman Sutera Utama",
            "queryPlace": "Taman Sutera Utama, Bukit Indah, Perling, Johor"
          },
          {
            "name": "Taman Sutera (Perling)",
            "queryPlace": "Taman Sutera, Bukit Indah, Perling, Johor"
          },
          {
            "name": "Danga Sutera",
            "queryPlace": "Danga Sutera, Bukit Indah, Perling, Johor"
          },
          {
            "name": "Taman Nusa Bestari (Nusa Bestari 1 & 2)",
            "queryPlace": "Taman Nusa Bestari, Bukit Indah, Perling, Johor"
          },
          {
            "name": "Taman Nusa Duta",
            "queryPlace": "Taman Nusa Duta, Bukit Indah, Perling, Johor"
          },
          {
            "name": "Taman Nusa Idaman (Precinct 1 – 8)",
            "queryPlace": "Taman Nusa Idaman, Bukit Indah, Perling, Johor"
          },
          {
            "name": "Taman Nusa Sentral",
            "queryPlace": "Taman Nusa Sentral, Bukit Indah, Perling, Johor"
          },
          {
            "name": "Taman Nusa Bayu",
            "queryPlace": "Taman Nusa Bayu, Bukit Indah, Perling, Johor"
          },
          {
            "name": "Taman Nusa Indah",
            "queryPlace": "Taman Nusa Indah, Bukit Indah, Perling, Johor"
          }
        ]
      },
      {
        "id": "johor_johor_bahru_skudai",
        "name": "Skudai",
        "fullName": "Skudai & Kangkar Pulai (MBIP)",
        "queryPlace": "Skudai, Johor Bahru, Johor",
        "tamans": [
          {
            "name": "Taman Universiti",
            "queryPlace": "Taman Universiti, Skudai, Johor"
          },
          {
            "name": "Taman Ungku Tun Aminah (TUTA)",
            "queryPlace": "Taman Ungku Tun Aminah, Skudai, Johor"
          },
          {
            "name": "Taman Mutiara Rini",
            "queryPlace": "Taman Mutiara Rini, Skudai, Johor"
          },
          {
            "name": "Taman Mutiara Mas",
            "queryPlace": "Taman Mutiara Mas, Skudai, Johor"
          },
          {
            "name": "Taman Skudai Baru",
            "queryPlace": "Taman Skudai Baru, Skudai, Johor"
          },
          {
            "name": "Taman Sri Skudai",
            "queryPlace": "Taman Sri Skudai, Skudai, Johor"
          },
          {
            "name": "Taman Desa Skudai",
            "queryPlace": "Taman Desa Skudai, Skudai, Johor"
          },
          {
            "name": "Taman Bukit Mewah",
            "queryPlace": "Taman Bukit Mewah, Skudai, Johor"
          },
          {
            "name": "Taman Mewah",
            "queryPlace": "Taman Mewah, Skudai, Johor"
          },
          {
            "name": "Taman Damai Jaya",
            "queryPlace": "Taman Damai Jaya, Skudai, Johor"
          },
          {
            "name": "Taman Selesa Jaya",
            "queryPlace": "Taman Selesa Jaya, Skudai, Johor"
          },
          {
            "name": "Taman Sri Orkid",
            "queryPlace": "Taman Sri Orkid, Skudai, Johor"
          },
          {
            "name": "Taman Pulai Flora",
            "queryPlace": "Taman Pulai Flora, Skudai, Johor"
          },
          {
            "name": "Taman Pulai Utama",
            "queryPlace": "Taman Pulai Utama, Skudai, Johor"
          },
          {
            "name": "Kangkar Pulai Town",
            "queryPlace": "Kangkar Pulai Town, Skudai, Johor"
          },
          {
            "name": "Bandar Baru Kangkar Pulai",
            "queryPlace": "Bandar Baru Kangkar Pulai, Skudai, Johor"
          },
          {
            "name": "Taman Pulai Indah",
            "queryPlace": "Taman Pulai Indah, Skudai, Johor"
          },
          {
            "name": "Taman Pulai Hijauan",
            "queryPlace": "Taman Pulai Hijauan, Skudai, Johor"
          },
          {
            "name": "Taman Pulai Mutiara",
            "queryPlace": "Taman Pulai Mutiara, Skudai, Johor"
          },
          {
            "name": "Taman Pulai Bestari",
            "queryPlace": "Taman Pulai Bestari, Skudai, Johor"
          },
          {
            "name": "Taman Pulai Emas",
            "queryPlace": "Taman Pulai Emas, Skudai, Johor"
          },
          {
            "name": "Taman Sri Pulai",
            "queryPlace": "Taman Sri Pulai, Skudai, Johor"
          },
          {
            "name": "Taman Sri Pulai Perdana",
            "queryPlace": "Taman Sri Pulai Perdana, Skudai, Johor"
          }
        ]
      },
      {
        "id": "johor_johor_bahru_gelang_patah",
        "name": "Gelang Patah",
        "fullName": "Gelang Patah & Tanjung Kupang (MBIP)",
        "queryPlace": "Gelang Patah, Johor Bahru, Johor",
        "tamans": [
          {
            "name": "Gelang Patah Town",
            "queryPlace": "Gelang Patah Town, Gelang Patah, Johor"
          },
          {
            "name": "Taman Nusa Perintis (1, 2, 3)",
            "queryPlace": "Taman Nusa Perintis, Gelang Patah, Johor"
          },
          {
            "name": "Taman Nusantara",
            "queryPlace": "Taman Nusantara, Gelang Patah, Johor"
          },
          {
            "name": "Taman Nusantara Prima",
            "queryPlace": "Taman Nusantara Prima, Gelang Patah, Johor"
          },
          {
            "name": "Setia Eco Garden",
            "queryPlace": "Setia Eco Garden, Gelang Patah, Johor"
          },
          {
            "name": "Taman Mas (Gelang Patah)",
            "queryPlace": "Taman Mas, Gelang Patah, Johor"
          },
          {
            "name": "Taman Gelang Emas",
            "queryPlace": "Taman Gelang Emas, Gelang Patah, Johor"
          },
          {
            "name": "Taman Tanjong Adang",
            "queryPlace": "Taman Tanjong Adang, Gelang Patah, Johor"
          },
          {
            "name": "Tanjung Kupang",
            "queryPlace": "Tanjung Kupang, Gelang Patah, Johor"
          },
          {
            "name": "Forest City",
            "queryPlace": "Forest City, Gelang Patah, Johor"
          }
        ]
      },
      {
        "id": "johor_johor_bahru_pasir_gudang",
        "name": "Pasir Gudang",
        "fullName": "Pasir Gudang Core (MBPG)",
        "queryPlace": "Pasir Gudang, Johor Bahru, Johor",
        "tamans": [
          {
            "name": "Pusat Bandar Pasir Gudang",
            "queryPlace": "Pusat Bandar Pasir Gudang, Pasir Gudang, Johor"
          },
          {
            "name": "Taman Pasir Putih",
            "queryPlace": "Taman Pasir Putih, Pasir Gudang, Johor"
          },
          {
            "name": "Taman Bukit Dahlia",
            "queryPlace": "Taman Bukit Dahlia, Pasir Gudang, Johor"
          },
          {
            "name": "Taman Air Biru",
            "queryPlace": "Taman Air Biru, Pasir Gudang, Johor"
          },
          {
            "name": "Taman Mawar",
            "queryPlace": "Taman Mawar, Pasir Gudang, Johor"
          },
          {
            "name": "Taman Cendana",
            "queryPlace": "Taman Cendana, Pasir Gudang, Johor"
          },
          {
            "name": "Taman Nusa Damai",
            "queryPlace": "Taman Nusa Damai, Pasir Gudang, Johor"
          },
          {
            "name": "Taman Scientex Pasir Gudang",
            "queryPlace": "Taman Scientex Pasir Gudang, Pasir Gudang, Johor"
          },
          {
            "name": "Taman Kota Masai (Eco Tropics)",
            "queryPlace": "Taman Kota Masai, Pasir Gudang, Johor"
          },
          {
            "name": "Taman Pasir Putih Baru",
            "queryPlace": "Taman Pasir Putih Baru, Pasir Gudang, Johor"
          },
          {
            "name": "Taman Tanjong Puteri Resort",
            "queryPlace": "Taman Tanjong Puteri Resort, Pasir Gudang, Johor"
          },
          {
            "name": "Kawasan Perindustrian Pasir Gudang",
            "queryPlace": "Kawasan Perindustrian Pasir Gudang, Pasir Gudang, Johor"
          },
          {
            "name": "Kawasan Perindustrian Tanjung Langsat",
            "queryPlace": "Kawasan Perindustrian Tanjung Langsat, Pasir Gudang, Johor"
          }
        ]
      },
      {
        "id": "johor_johor_bahru_masai",
        "name": "Masai",
        "fullName": "Masai & Seri Alam (MBPG)",
        "queryPlace": "Masai, Johor Bahru, Johor",
        "tamans": [
          {
            "name": "Bandar Seri Alam",
            "queryPlace": "Bandar Seri Alam, Masai, Johor"
          },
          {
            "name": "Taman Rinting",
            "queryPlace": "Taman Rinting, Masai, Johor"
          },
          {
            "name": "Taman Megah Ria",
            "queryPlace": "Taman Megah Ria, Masai, Johor"
          },
          {
            "name": "Taman Masai Utama",
            "queryPlace": "Taman Masai Utama, Masai, Johor"
          },
          {
            "name": "Taman Masai Jaya",
            "queryPlace": "Taman Masai Jaya, Masai, Johor"
          },
          {
            "name": "Taman Bukit Tiram (Masai)",
            "queryPlace": "Taman Bukit Tiram, Masai, Johor"
          },
          {
            "name": "Taman Cahaya Kota Puteri",
            "queryPlace": "Taman Cahaya Kota Puteri, Masai, Johor"
          },
          {
            "name": "Taman Sierra Perdana",
            "queryPlace": "Taman Sierra Perdana, Masai, Johor"
          },
          {
            "name": "Taman Flora Heights",
            "queryPlace": "Taman Flora Heights, Masai, Johor"
          },
          {
            "name": "Taman Seri Megah",
            "queryPlace": "Taman Seri Megah, Masai, Johor"
          },
          {
            "name": "Taman Tanjung Puteri",
            "queryPlace": "Taman Tanjung Puteri, Masai, Johor"
          }
        ]
      }
    ]
  },
  {
    "id": "johor_kulai",
    "num": 2,
    "name": "Kulai",
    "state": "Johor",
    "towns": [
      {
        "id": "johor_kulai_kulai",
        "name": "Kulai",
        "fullName": "Kulai Town",
        "queryPlace": "Kulai, Kulai, Johor",
        "tamans": [
          {
            "name": "Bandar Putra Kulai (IOI)",
            "queryPlace": "Bandar Putra Kulai, Kulai, Johor"
          },
          {
            "name": "Taman Putri Kulai",
            "queryPlace": "Taman Putri Kulai, Kulai, Johor"
          },
          {
            "name": "Kulai Indahpura (Genting Indahpura)",
            "queryPlace": "Kulai Indahpura, Kulai, Johor"
          },
          {
            "name": "Taman Kulai Besar",
            "queryPlace": "Taman Kulai Besar, Kulai, Johor"
          },
          {
            "name": "Taman Kulai",
            "queryPlace": "Taman Kulai, Kulai, Johor"
          },
          {
            "name": "Taman Kulai Utama",
            "queryPlace": "Taman Kulai Utama, Kulai, Johor"
          },
          {
            "name": "Taman Sri Kulai",
            "queryPlace": "Taman Sri Kulai, Kulai, Johor"
          },
          {
            "name": "Taman Sri Kulai Baru",
            "queryPlace": "Taman Sri Kulai Baru, Kulai, Johor"
          },
          {
            "name": "Taman Bersatu",
            "queryPlace": "Taman Bersatu, Kulai, Johor"
          },
          {
            "name": "Taman Khet Long",
            "queryPlace": "Taman Khet Long, Kulai, Johor"
          },
          {
            "name": "Taman Permai",
            "queryPlace": "Taman Permai, Kulai, Johor"
          },
          {
            "name": "Taman Sri Sentosa",
            "queryPlace": "Taman Sri Sentosa, Kulai, Johor"
          },
          {
            "name": "Taman Lagenda Putra",
            "queryPlace": "Taman Lagenda Putra, Kulai, Johor"
          },
          {
            "name": "Taman Scientex Kulai",
            "queryPlace": "Taman Scientex Kulai, Kulai, Johor"
          },
          {
            "name": "Taman Saujana Jaya",
            "queryPlace": "Taman Saujana Jaya, Kulai, Johor"
          },
          {
            "name": "Taman Mewah",
            "queryPlace": "Taman Mewah, Kulai, Johor"
          },
          {
            "name": "Taman Gemilang",
            "queryPlace": "Taman Gemilang, Kulai, Johor"
          },
          {
            "name": "Taman Mas (Kulai)",
            "queryPlace": "Taman Mas, Kulai, Johor"
          },
          {
            "name": "Taman Saga",
            "queryPlace": "Taman Saga, Kulai, Johor"
          },
          {
            "name": "Taman Anggerik",
            "queryPlace": "Taman Anggerik, Kulai, Johor"
          },
          {
            "name": "Taman Murni",
            "queryPlace": "Taman Murni, Kulai, Johor"
          },
          {
            "name": "Taman Cantik",
            "queryPlace": "Taman Cantik, Kulai, Johor"
          },
          {
            "name": "Taman Senai Permai",
            "queryPlace": "Taman Senai Permai, Kulai, Johor"
          },
          {
            "name": "Taman Muhibbah",
            "queryPlace": "Taman Muhibbah, Kulai, Johor"
          },
          {
            "name": "Taman D'Putra Suites Area",
            "queryPlace": "Taman D'Putra Suites Area, Kulai, Johor"
          }
        ]
      },
      {
        "id": "johor_kulai_senai",
        "name": "Senai",
        "fullName": "Senai",
        "queryPlace": "Senai, Kulai, Johor",
        "tamans": [
          {
            "name": "Taman Senai Utama",
            "queryPlace": "Taman Senai Utama, Senai, Johor"
          },
          {
            "name": "Taman Senai Baru",
            "queryPlace": "Taman Senai Baru, Senai, Johor"
          },
          {
            "name": "Taman Bintang Senai",
            "queryPlace": "Taman Bintang Senai, Senai, Johor"
          },
          {
            "name": "Taman Sri Senai",
            "queryPlace": "Taman Sri Senai, Senai, Johor"
          },
          {
            "name": "Taman Senai Indah",
            "queryPlace": "Taman Senai Indah, Senai, Johor"
          },
          {
            "name": "Taman Impian Senai",
            "queryPlace": "Taman Impian Senai, Senai, Johor"
          },
          {
            "name": "Taman Handal",
            "queryPlace": "Taman Handal, Senai, Johor"
          },
          {
            "name": "Taman Desa Idaman",
            "queryPlace": "Taman Desa Idaman, Senai, Johor"
          },
          {
            "name": "Taman Bukit Senai",
            "queryPlace": "Taman Bukit Senai, Senai, Johor"
          },
          {
            "name": "Taman DAP Senai",
            "queryPlace": "Taman DAP Senai, Senai, Johor"
          },
          {
            "name": "Taman Bahagia (Senai)",
            "queryPlace": "Taman Bahagia, Senai, Johor"
          },
          {
            "name": "Scientex Senai",
            "queryPlace": "Scientex Senai, Senai, Johor"
          },
          {
            "name": "Eco Business Park II",
            "queryPlace": "Eco Business Park II, Senai, Johor"
          },
          {
            "name": "Senai Airport City Commercial & Industrial Zone",
            "queryPlace": "Senai Airport City Commercial & Industrial Zone, Senai, Johor"
          }
        ]
      },
      {
        "id": "johor_kulai_saleng",
        "name": "Saleng",
        "fullName": "Saleng",
        "queryPlace": "Saleng, Kulai, Johor",
        "tamans": [
          {
            "name": "Taman Saleng Baru",
            "queryPlace": "Taman Saleng Baru, Saleng, Johor"
          },
          {
            "name": "Taman Saleng Gaya",
            "queryPlace": "Taman Saleng Gaya, Saleng, Johor"
          },
          {
            "name": "Taman Saleng Indah",
            "queryPlace": "Taman Saleng Indah, Saleng, Johor"
          },
          {
            "name": "Taman Sri Saleng",
            "queryPlace": "Taman Sri Saleng, Saleng, Johor"
          },
          {
            "name": "Taman Sutera (Saleng)",
            "queryPlace": "Taman Sutera, Saleng, Johor"
          },
          {
            "name": "Kampung Baru Saleng",
            "queryPlace": "Kampung Baru Saleng, Saleng, Johor"
          }
        ]
      },
      {
        "id": "johor_kulai_kelapa_sawit",
        "name": "Kelapa Sawit",
        "fullName": "Kelapa Sawit",
        "queryPlace": "Kelapa Sawit, Kulai, Johor",
        "tamans": [
          {
            "name": "Taman Manis (Fasa 1, 2, 3)",
            "queryPlace": "Taman Manis, Kelapa Sawit, Johor"
          },
          {
            "name": "Taman Kelapa Sawit",
            "queryPlace": "Taman Kelapa Sawit, Kelapa Sawit, Johor"
          },
          {
            "name": "Taman Sawit Indah",
            "queryPlace": "Taman Sawit Indah, Kelapa Sawit, Johor"
          },
          {
            "name": "Taman Sri Sawit",
            "queryPlace": "Taman Sri Sawit, Kelapa Sawit, Johor"
          },
          {
            "name": "Kampung Baru Kelapa Sawit",
            "queryPlace": "Kampung Baru Kelapa Sawit, Kelapa Sawit, Johor"
          }
        ]
      },
      {
        "id": "johor_kulai_sedenak",
        "name": "Sedenak",
        "fullName": "Sedenak & Bukit Batu",
        "queryPlace": "Sedenak, Kulai, Johor",
        "tamans": [
          {
            "name": "Kampung Baru Sedenak",
            "queryPlace": "Kampung Baru Sedenak, Sedenak, Johor"
          },
          {
            "name": "Felda Bukit Batu",
            "queryPlace": "Felda Bukit Batu, Sedenak, Johor"
          },
          {
            "name": "Taman Bukit Batu",
            "queryPlace": "Taman Bukit Batu, Sedenak, Johor"
          },
          {
            "name": "Kampung Ayer Manis",
            "queryPlace": "Kampung Ayer Manis, Sedenak, Johor"
          }
        ]
      },
      {
        "id": "johor_kulai_seelong",
        "name": "Seelong",
        "fullName": "Seelong",
        "queryPlace": "Seelong, Kulai, Johor",
        "tamans": [
          {
            "name": "Kampung Seelong",
            "queryPlace": "Kampung Seelong, Seelong, Johor"
          },
          {
            "name": "Kampung Seelong Jaya",
            "queryPlace": "Kampung Seelong Jaya, Seelong, Johor"
          },
          {
            "name": "Taman Perindustrian Seelong",
            "queryPlace": "Taman Perindustrian Seelong, Seelong, Johor"
          }
        ]
      }
    ]
  },
  {
    "id": "johor_batu_pahat",
    "num": 3,
    "name": "Batu Pahat",
    "state": "Johor",
    "towns": [
      {
        "id": "johor_batu_pahat_bandar_penggaram",
        "name": "Bandar Penggaram",
        "fullName": "Bandar Penggaram (Batu Pahat Town Core)",
        "queryPlace": "Bandar Penggaram, Batu Pahat, Johor",
        "tamans": [
          {
            "name": "Taman Bukit Perdana (1 & 2)",
            "queryPlace": "Taman Bukit Perdana, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Soga",
            "queryPlace": "Taman Soga, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Banang Jaya",
            "queryPlace": "Taman Banang Jaya, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Bandar",
            "queryPlace": "Taman Bandar, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Desa Botani",
            "queryPlace": "Taman Desa Botani, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Bukit Mutiara",
            "queryPlace": "Taman Bukit Mutiara, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Kemajuan",
            "queryPlace": "Taman Kemajuan, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Tanjung & Taman Tanjung Indah",
            "queryPlace": "Taman Tanjung & Taman Tanjung Indah, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Ampang Jaya",
            "queryPlace": "Taman Ampang Jaya, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Ampuan",
            "queryPlace": "Taman Ampuan, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Pantai Baru",
            "queryPlace": "Taman Pantai Baru, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Flora Utama",
            "queryPlace": "Taman Flora Utama, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Maju",
            "queryPlace": "Taman Maju, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Pegawai",
            "queryPlace": "Taman Pegawai, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Koperasi Bahagia",
            "queryPlace": "Taman Koperasi Bahagia, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Bukit Pasir (Batu Pahat)",
            "queryPlace": "Taman Bukit Pasir, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Megah",
            "queryPlace": "Taman Megah, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Mutiara Perdana",
            "queryPlace": "Taman Mutiara Perdana, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Pelangi (Batu Pahat)",
            "queryPlace": "Taman Pelangi, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Beroleh",
            "queryPlace": "Taman Beroleh, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Damai (Batu Pahat)",
            "queryPlace": "Taman Damai, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Mewah",
            "queryPlace": "Taman Mewah, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Limpoon",
            "queryPlace": "Taman Limpoon, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Setia Jaya",
            "queryPlace": "Taman Setia Jaya, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Gembira",
            "queryPlace": "Taman Gembira, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Bukit Permai",
            "queryPlace": "Taman Bukit Permai, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Bukit Indah (Batu Pahat)",
            "queryPlace": "Taman Bukit Indah, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Orchard Heights",
            "queryPlace": "Taman Orchard Heights, Bandar Penggaram, Johor"
          },
          {
            "name": "Taman Puteri Indah",
            "queryPlace": "Taman Puteri Indah, Bandar Penggaram, Johor"
          }
        ]
      },
      {
        "id": "johor_batu_pahat_yong_peng",
        "name": "Yong Peng",
        "fullName": "Yong Peng (MDYP)",
        "queryPlace": "Yong Peng, Batu Pahat, Johor",
        "tamans": [
          {
            "name": "Taman Selatan & Taman Selatan Baru",
            "queryPlace": "Taman Selatan & Taman Selatan Baru, Yong Peng, Johor"
          },
          {
            "name": "Taman Berlian",
            "queryPlace": "Taman Berlian, Yong Peng, Johor"
          },
          {
            "name": "Taman Desa Yong Peng Baru",
            "queryPlace": "Taman Desa Yong Peng Baru, Yong Peng, Johor"
          },
          {
            "name": "Taman Durian",
            "queryPlace": "Taman Durian, Yong Peng, Johor"
          },
          {
            "name": "Taman Suria (Yong Peng)",
            "queryPlace": "Taman Suria, Yong Peng, Johor"
          },
          {
            "name": "Taman Madu",
            "queryPlace": "Taman Madu, Yong Peng, Johor"
          },
          {
            "name": "Taman Sri Aman",
            "queryPlace": "Taman Sri Aman, Yong Peng, Johor"
          },
          {
            "name": "Taman Kotamas",
            "queryPlace": "Taman Kotamas, Yong Peng, Johor"
          },
          {
            "name": "Taman Sembrong & Taman Sembrong Baru",
            "queryPlace": "Taman Sembrong & Taman Sembrong Baru, Yong Peng, Johor"
          },
          {
            "name": "Taman Bandar Cahaya Baru",
            "queryPlace": "Taman Bandar Cahaya Baru, Yong Peng, Johor"
          },
          {
            "name": "Taman Seri Bayu",
            "queryPlace": "Taman Seri Bayu, Yong Peng, Johor"
          },
          {
            "name": "Taman Kota",
            "queryPlace": "Taman Kota, Yong Peng, Johor"
          },
          {
            "name": "Taman Utama (Yong Peng)",
            "queryPlace": "Taman Utama, Yong Peng, Johor"
          },
          {
            "name": "Taman Mewah (Yong Peng)",
            "queryPlace": "Taman Mewah, Yong Peng, Johor"
          },
          {
            "name": "Taman Sutera (Yong Peng)",
            "queryPlace": "Taman Sutera, Yong Peng, Johor"
          },
          {
            "name": "Taman Sri Bertam",
            "queryPlace": "Taman Sri Bertam, Yong Peng, Johor"
          },
          {
            "name": "Taman Bukit Tropika",
            "queryPlace": "Taman Bukit Tropika, Yong Peng, Johor"
          },
          {
            "name": "Taman Sinar Impian",
            "queryPlace": "Taman Sinar Impian, Yong Peng, Johor"
          },
          {
            "name": "Taman Kota Impian",
            "queryPlace": "Taman Kota Impian, Yong Peng, Johor"
          },
          {
            "name": "Taman Damai Jaya",
            "queryPlace": "Taman Damai Jaya, Yong Peng, Johor"
          },
          {
            "name": "Taman Orkid (Yong Peng)",
            "queryPlace": "Taman Orkid, Yong Peng, Johor"
          }
        ]
      },
      {
        "id": "johor_batu_pahat_ayer_hitam",
        "name": "Ayer Hitam",
        "fullName": "Ayer Hitam (MDYP)",
        "queryPlace": "Ayer Hitam, Batu Pahat, Johor",
        "tamans": [
          {
            "name": "Taman Bukit Indah (Ayer Hitam)",
            "queryPlace": "Taman Bukit Indah, Ayer Hitam, Johor"
          },
          {
            "name": "Taman Perdana (Ayer Hitam)",
            "queryPlace": "Taman Perdana, Ayer Hitam, Johor"
          },
          {
            "name": "Taman Suria Ayer Hitam",
            "queryPlace": "Taman Suria Ayer Hitam, Ayer Hitam, Johor"
          },
          {
            "name": "Taman UPC",
            "queryPlace": "Taman UPC, Ayer Hitam, Johor"
          },
          {
            "name": "Taman Mekar & Taman Mekar Emas",
            "queryPlace": "Taman Mekar & Taman Mekar Emas, Ayer Hitam, Johor"
          },
          {
            "name": "Taman Kirana",
            "queryPlace": "Taman Kirana, Ayer Hitam, Johor"
          },
          {
            "name": "Taman Desa Baru",
            "queryPlace": "Taman Desa Baru, Ayer Hitam, Johor"
          },
          {
            "name": "Taman Ros (Taman Pahlawan)",
            "queryPlace": "Taman Ros, Ayer Hitam, Johor"
          },
          {
            "name": "Taman Indah Jaya",
            "queryPlace": "Taman Indah Jaya, Ayer Hitam, Johor"
          },
          {
            "name": "Taman Harmoni",
            "queryPlace": "Taman Harmoni, Ayer Hitam, Johor"
          }
        ]
      },
      {
        "id": "johor_batu_pahat_parit_raja",
        "name": "Parit Raja",
        "fullName": "Parit Raja",
        "queryPlace": "Parit Raja, Batu Pahat, Johor",
        "tamans": [
          {
            "name": "Taman Manis (Parit Raja)",
            "queryPlace": "Taman Manis, Parit Raja, Johor"
          },
          {
            "name": "Taman Melewar",
            "queryPlace": "Taman Melewar, Parit Raja, Johor"
          },
          {
            "name": "Taman Maju & Taman Maju Baru",
            "queryPlace": "Taman Maju & Taman Maju Baru, Parit Raja, Johor"
          },
          {
            "name": "Taman Wira Jaya",
            "queryPlace": "Taman Wira Jaya, Parit Raja, Johor"
          },
          {
            "name": "Taman Impian",
            "queryPlace": "Taman Impian, Parit Raja, Johor"
          },
          {
            "name": "Taman Bandar Universiti",
            "queryPlace": "Taman Bandar Universiti, Parit Raja, Johor"
          },
          {
            "name": "Taman Parit Raja",
            "queryPlace": "Taman Parit Raja, Parit Raja, Johor"
          },
          {
            "name": "Taman Aked",
            "queryPlace": "Taman Aked, Parit Raja, Johor"
          },
          {
            "name": "Taman Siswa Jaya",
            "queryPlace": "Taman Siswa Jaya, Parit Raja, Johor"
          },
          {
            "name": "Taman Kelisa Jaya",
            "queryPlace": "Taman Kelisa Jaya, Parit Raja, Johor"
          },
          {
            "name": "Taman Firus",
            "queryPlace": "Taman Firus, Parit Raja, Johor"
          },
          {
            "name": "Taman Wira Budiman",
            "queryPlace": "Taman Wira Budiman, Parit Raja, Johor"
          },
          {
            "name": "Taman Robena",
            "queryPlace": "Taman Robena, Parit Raja, Johor"
          },
          {
            "name": "Taman Sedap",
            "queryPlace": "Taman Sedap, Parit Raja, Johor"
          },
          {
            "name": "Taman Persona Indah",
            "queryPlace": "Taman Persona Indah, Parit Raja, Johor"
          },
          {
            "name": "Taman Rona",
            "queryPlace": "Taman Rona, Parit Raja, Johor"
          }
        ]
      },
      {
        "id": "johor_batu_pahat_sri_gading",
        "name": "Sri Gading",
        "fullName": "Sri Gading",
        "queryPlace": "Sri Gading, Batu Pahat, Johor",
        "tamans": [
          {
            "name": "Bandar Genting Pura Kencana",
            "queryPlace": "Bandar Genting Pura Kencana, Sri Gading, Johor"
          },
          {
            "name": "Taman Mutiara Gading",
            "queryPlace": "Taman Mutiara Gading, Sri Gading, Johor"
          },
          {
            "name": "Taman Sri Gading (1 & 2)",
            "queryPlace": "Taman Sri Gading, Sri Gading, Johor"
          },
          {
            "name": "Taman Gading Baru",
            "queryPlace": "Taman Gading Baru, Sri Gading, Johor"
          },
          {
            "name": "Taman Wira",
            "queryPlace": "Taman Wira, Sri Gading, Johor"
          },
          {
            "name": "Kawasan Perindustrian Sri Gading",
            "queryPlace": "Kawasan Perindustrian Sri Gading, Sri Gading, Johor"
          }
        ]
      },
      {
        "id": "johor_batu_pahat_tongkang_pechah",
        "name": "Tongkang Pechah",
        "fullName": "Tongkang Pechah",
        "queryPlace": "Tongkang Pechah, Batu Pahat, Johor",
        "tamans": [
          {
            "name": "Bandar Putera Indah",
            "queryPlace": "Bandar Putera Indah, Tongkang Pechah, Johor"
          },
          {
            "name": "Taman Putera Indah",
            "queryPlace": "Taman Putera Indah, Tongkang Pechah, Johor"
          },
          {
            "name": "Taman Tongkang Pechah",
            "queryPlace": "Taman Tongkang Pechah, Tongkang Pechah, Johor"
          },
          {
            "name": "Taman Sri Tongkang",
            "queryPlace": "Taman Sri Tongkang, Tongkang Pechah, Johor"
          },
          {
            "name": "Taman Desa Molek",
            "queryPlace": "Taman Desa Molek, Tongkang Pechah, Johor"
          },
          {
            "name": "Taman Tiara Perdana",
            "queryPlace": "Taman Tiara Perdana, Tongkang Pechah, Johor"
          }
        ]
      },
      {
        "id": "johor_batu_pahat_senggarang",
        "name": "Senggarang",
        "fullName": "Senggarang",
        "queryPlace": "Senggarang, Batu Pahat, Johor",
        "tamans": [
          {
            "name": "Taman Senggarang",
            "queryPlace": "Taman Senggarang, Senggarang, Johor"
          },
          {
            "name": "Taman Sri Senggarang",
            "queryPlace": "Taman Sri Senggarang, Senggarang, Johor"
          },
          {
            "name": "Taman Sri Raya",
            "queryPlace": "Taman Sri Raya, Senggarang, Johor"
          },
          {
            "name": "Taman Sri Mewah",
            "queryPlace": "Taman Sri Mewah, Senggarang, Johor"
          },
          {
            "name": "Taman Senggarang Impian",
            "queryPlace": "Taman Senggarang Impian, Senggarang, Johor"
          },
          {
            "name": "Taman Senggarang Baru",
            "queryPlace": "Taman Senggarang Baru, Senggarang, Johor"
          }
        ]
      },
      {
        "id": "johor_batu_pahat_rengit",
        "name": "Rengit",
        "fullName": "Rengit",
        "queryPlace": "Rengit, Batu Pahat, Johor",
        "tamans": [
          {
            "name": "Taman Rengit",
            "queryPlace": "Taman Rengit, Rengit, Johor"
          },
          {
            "name": "Taman Rengit Damai",
            "queryPlace": "Taman Rengit Damai, Rengit, Johor"
          },
          {
            "name": "Taman Rengit Mewah",
            "queryPlace": "Taman Rengit Mewah, Rengit, Johor"
          },
          {
            "name": "Taman Rengit Bahagia",
            "queryPlace": "Taman Rengit Bahagia, Rengit, Johor"
          },
          {
            "name": "Taman Rengit Jaya",
            "queryPlace": "Taman Rengit Jaya, Rengit, Johor"
          },
          {
            "name": "Taman Karang Muhibbah",
            "queryPlace": "Taman Karang Muhibbah, Rengit, Johor"
          },
          {
            "name": "Taman Pandan Jaya",
            "queryPlace": "Taman Pandan Jaya, Rengit, Johor"
          },
          {
            "name": "Taman Rengit Indah",
            "queryPlace": "Taman Rengit Indah, Rengit, Johor"
          },
          {
            "name": "Taman Sri Rengit",
            "queryPlace": "Taman Sri Rengit, Rengit, Johor"
          }
        ]
      },
      {
        "id": "johor_batu_pahat_semerah",
        "name": "Semerah",
        "fullName": "Semerah",
        "queryPlace": "Semerah, Batu Pahat, Johor",
        "tamans": [
          {
            "name": "Taman Semerah",
            "queryPlace": "Taman Semerah, Semerah, Johor"
          },
          {
            "name": "Taman Seri Semerah",
            "queryPlace": "Taman Seri Semerah, Semerah, Johor"
          },
          {
            "name": "Taman Semerah Indah",
            "queryPlace": "Taman Semerah Indah, Semerah, Johor"
          },
          {
            "name": "Taman Semerah Jaya",
            "queryPlace": "Taman Semerah Jaya, Semerah, Johor"
          }
        ]
      }
    ]
  },
  {
    "id": "johor_kluang",
    "num": 4,
    "name": "Kluang",
    "state": "Johor",
    "towns": [
      {
        "id": "johor_kluang_kluang",
        "name": "Kluang",
        "fullName": "Kluang Town Core (MPK)",
        "queryPlace": "Kluang, Kluang, Johor",
        "tamans": [
          {
            "name": "Bandar Seri Impian",
            "queryPlace": "Bandar Seri Impian, Kluang, Johor"
          },
          {
            "name": "Taman Sri Kluang (Seri Kluang)",
            "queryPlace": "Taman Sri Kluang, Kluang, Johor"
          },
          {
            "name": "Taman Intan",
            "queryPlace": "Taman Intan, Kluang, Johor"
          },
          {
            "name": "Taman Kluang Baru",
            "queryPlace": "Taman Kluang Baru, Kluang, Johor"
          },
          {
            "name": "Taman Berlian Biru",
            "queryPlace": "Taman Berlian Biru, Kluang, Johor"
          },
          {
            "name": "Taman Bersatu",
            "queryPlace": "Taman Bersatu, Kluang, Johor"
          },
          {
            "name": "Taman Desa",
            "queryPlace": "Taman Desa, Kluang, Johor"
          },
          {
            "name": "Taman Emas",
            "queryPlace": "Taman Emas, Kluang, Johor"
          },
          {
            "name": "Taman Kluang Jaya",
            "queryPlace": "Taman Kluang Jaya, Kluang, Johor"
          },
          {
            "name": "Taman Nilam",
            "queryPlace": "Taman Nilam, Kluang, Johor"
          },
          {
            "name": "Taman Permata",
            "queryPlace": "Taman Permata, Kluang, Johor"
          },
          {
            "name": "Taman Tasik",
            "queryPlace": "Taman Tasik, Kluang, Johor"
          },
          {
            "name": "Taman Gunung Lambak",
            "queryPlace": "Taman Gunung Lambak, Kluang, Johor"
          },
          {
            "name": "Taman Kluang Barat",
            "queryPlace": "Taman Kluang Barat, Kluang, Johor"
          },
          {
            "name": "Taman Aman",
            "queryPlace": "Taman Aman, Kluang, Johor"
          },
          {
            "name": "Taman Bahagia",
            "queryPlace": "Taman Bahagia, Kluang, Johor"
          },
          {
            "name": "Taman Harmoni (Kluang)",
            "queryPlace": "Taman Harmoni, Kluang, Johor"
          },
          {
            "name": "Taman Delima (1 & 2)",
            "queryPlace": "Taman Delima, Kluang, Johor"
          },
          {
            "name": "Taman Saujana",
            "queryPlace": "Taman Saujana, Kluang, Johor"
          },
          {
            "name": "Taman Sunrise",
            "queryPlace": "Taman Sunrise, Kluang, Johor"
          },
          {
            "name": "Taman Sam Hoe",
            "queryPlace": "Taman Sam Hoe, Kluang, Johor"
          },
          {
            "name": "Taman Sri Jaya",
            "queryPlace": "Taman Sri Jaya, Kluang, Johor"
          },
          {
            "name": "Taman Mengkibol",
            "queryPlace": "Taman Mengkibol, Kluang, Johor"
          },
          {
            "name": "Taman Lian Seng",
            "queryPlace": "Taman Lian Seng, Kluang, Johor"
          },
          {
            "name": "Taman Yap Tau Sah",
            "queryPlace": "Taman Yap Tau Sah, Kluang, Johor"
          },
          {
            "name": "Taman Dato' Shahbandar",
            "queryPlace": "Taman Dato' Shahbandar, Kluang, Johor"
          },
          {
            "name": "Taman Kluang Perdana",
            "queryPlace": "Taman Kluang Perdana, Kluang, Johor"
          },
          {
            "name": "Taman Kampung Gajah",
            "queryPlace": "Taman Kampung Gajah, Kluang, Johor"
          },
          {
            "name": "Taman Sri Lalang (Kluang)",
            "queryPlace": "Taman Sri Lalang, Kluang, Johor"
          }
        ]
      },
      {
        "id": "johor_kluang_simpang_renggam",
        "name": "Simpang Renggam",
        "fullName": "Simpang Renggam (MDSR)",
        "queryPlace": "Simpang Renggam, Kluang, Johor",
        "tamans": [
          {
            "name": "Taman Renggam Jaya",
            "queryPlace": "Taman Renggam Jaya, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Tiara Perdana",
            "queryPlace": "Taman Tiara Perdana, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Purnama",
            "queryPlace": "Taman Purnama, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Berjaya (Simpang Renggam)",
            "queryPlace": "Taman Berjaya, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Sentosa",
            "queryPlace": "Taman Sentosa, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Sri Puteri",
            "queryPlace": "Taman Sri Puteri, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Orkid",
            "queryPlace": "Taman Orkid, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Jaya 1",
            "queryPlace": "Taman Jaya 1, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Reka Mas",
            "queryPlace": "Taman Reka Mas, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Sri Mewah",
            "queryPlace": "Taman Sri Mewah, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Bukit Renggam",
            "queryPlace": "Taman Bukit Renggam, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Mohd Yassin",
            "queryPlace": "Taman Mohd Yassin, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Permata",
            "queryPlace": "Taman Permata, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Muhibbah",
            "queryPlace": "Taman Muhibbah, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Putrimas",
            "queryPlace": "Taman Putrimas, Simpang Renggam, Johor"
          },
          {
            "name": "Taman Era Simpang Renggam",
            "queryPlace": "Taman Era Simpang Renggam, Simpang Renggam, Johor"
          },
          {
            "name": "Era Park",
            "queryPlace": "Era Park, Simpang Renggam, Johor"
          },
          {
            "name": "Residensi Bangsa Johor @ Simpang Renggam",
            "queryPlace": "Residensi Bangsa Johor @ Simpang Renggam, Simpang Renggam, Johor"
          }
        ]
      },
      {
        "id": "johor_kluang_paloh",
        "name": "Paloh",
        "fullName": "Paloh",
        "queryPlace": "Paloh, Kluang, Johor",
        "tamans": [
          {
            "name": "Taman Sri Paloh",
            "queryPlace": "Taman Sri Paloh, Paloh, Johor"
          },
          {
            "name": "Taman Kota Paloh",
            "queryPlace": "Taman Kota Paloh, Paloh, Johor"
          },
          {
            "name": "Taman Melati Paloh",
            "queryPlace": "Taman Melati Paloh, Paloh, Johor"
          },
          {
            "name": "Taman Murni Paloh",
            "queryPlace": "Taman Murni Paloh, Paloh, Johor"
          },
          {
            "name": "Taman Seri Palma Paloh",
            "queryPlace": "Taman Seri Palma Paloh, Paloh, Johor"
          },
          {
            "name": "Taman Indah Paloh",
            "queryPlace": "Taman Indah Paloh, Paloh, Johor"
          },
          {
            "name": "Kampung Aman Paloh",
            "queryPlace": "Kampung Aman Paloh, Paloh, Johor"
          },
          {
            "name": "Kampung Muhibbah Paloh",
            "queryPlace": "Kampung Muhibbah Paloh, Paloh, Johor"
          },
          {
            "name": "Rumah Murah Paloh",
            "queryPlace": "Rumah Murah Paloh, Paloh, Johor"
          }
        ]
      },
      {
        "id": "johor_kluang_layang_layang",
        "name": "Layang-Layang",
        "fullName": "Layang-Layang",
        "queryPlace": "Layang-Layang, Kluang, Johor",
        "tamans": [
          {
            "name": "Taman Sri Layang-Layang",
            "queryPlace": "Taman Sri Layang-Layang, Layang-Layang, Johor"
          },
          {
            "name": "Taman Layang-Layang",
            "queryPlace": "Taman Layang-Layang, Layang-Layang, Johor"
          },
          {
            "name": "Taman Permata Layang",
            "queryPlace": "Taman Permata Layang, Layang-Layang, Johor"
          },
          {
            "name": "Taman Sri Maju",
            "queryPlace": "Taman Sri Maju, Layang-Layang, Johor"
          },
          {
            "name": "Taman Puteri Layang-Layang",
            "queryPlace": "Taman Puteri Layang-Layang, Layang-Layang, Johor"
          },
          {
            "name": "Taman Sri Mawar",
            "queryPlace": "Taman Sri Mawar, Layang-Layang, Johor"
          },
          {
            "name": "Pekan Layang-Layang Baru",
            "queryPlace": "Pekan Layang-Layang Baru, Layang-Layang, Johor"
          },
          {
            "name": "Rumah Murah Layang-Layang",
            "queryPlace": "Rumah Murah Layang-Layang, Layang-Layang, Johor"
          }
        ]
      },
      {
        "id": "johor_kluang_renggam",
        "name": "Renggam",
        "fullName": "Renggam",
        "queryPlace": "Renggam, Kluang, Johor",
        "tamans": [
          {
            "name": "Taman Sri Jaya Renggam",
            "queryPlace": "Taman Sri Jaya Renggam, Renggam, Johor"
          },
          {
            "name": "Taman Harmoni (Renggam)",
            "queryPlace": "Taman Harmoni, Renggam, Johor"
          },
          {
            "name": "Taman Flora (Renggam)",
            "queryPlace": "Taman Flora, Renggam, Johor"
          },
          {
            "name": "Taman Makmur",
            "queryPlace": "Taman Makmur, Renggam, Johor"
          },
          {
            "name": "Taman Nilam (Renggam)",
            "queryPlace": "Taman Nilam, Renggam, Johor"
          },
          {
            "name": "Taman Perdana",
            "queryPlace": "Taman Perdana, Renggam, Johor"
          },
          {
            "name": "Taman Suria Jaya",
            "queryPlace": "Taman Suria Jaya, Renggam, Johor"
          }
        ]
      },
      {
        "id": "johor_kluang_kahang",
        "name": "Kahang",
        "fullName": "Kahang",
        "queryPlace": "Kahang, Kluang, Johor",
        "tamans": [
          {
            "name": "Taman Sri Kahang",
            "queryPlace": "Taman Sri Kahang, Kahang, Johor"
          },
          {
            "name": "Taman Kahang Baru",
            "queryPlace": "Taman Kahang Baru, Kahang, Johor"
          },
          {
            "name": "Taman Kahang Emas",
            "queryPlace": "Taman Kahang Emas, Kahang, Johor"
          },
          {
            "name": "Taman Desa Kahang",
            "queryPlace": "Taman Desa Kahang, Kahang, Johor"
          },
          {
            "name": "Kampung Baru Kahang",
            "queryPlace": "Kampung Baru Kahang, Kahang, Johor"
          }
        ]
      },
      {
        "id": "johor_kluang_machap",
        "name": "Machap",
        "fullName": "Machap",
        "queryPlace": "Machap, Kluang, Johor",
        "tamans": [
          {
            "name": "Taman Machap Jaya",
            "queryPlace": "Taman Machap Jaya, Machap, Johor"
          },
          {
            "name": "Taman Sri Machap",
            "queryPlace": "Taman Sri Machap, Machap, Johor"
          },
          {
            "name": "Kampung Baru Machap",
            "queryPlace": "Kampung Baru Machap, Machap, Johor"
          }
        ]
      }
    ]
  },
  {
    "id": "johor_muar",
    "num": 5,
    "name": "Muar",
    "state": "Johor",
    "towns": [
      {
        "id": "johor_muar_bandar_maharani",
        "name": "Bandar Maharani",
        "fullName": "Bandar Maharani (Muar Town Core)",
        "queryPlace": "Bandar Maharani, Muar, Johor",
        "tamans": [
          {
            "name": "Taman Sri Temenggong",
            "queryPlace": "Taman Sri Temenggong, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Temiang Jaya (1 & 2)",
            "queryPlace": "Taman Temiang Jaya, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Putera Indah",
            "queryPlace": "Taman Putera Indah, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Sakeh Baru",
            "queryPlace": "Taman Sakeh Baru, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Seri Treh (Taman Bintang Angkasa)",
            "queryPlace": "Taman Seri Treh, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Melati",
            "queryPlace": "Taman Melati, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Mahkota",
            "queryPlace": "Taman Mahkota, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Lembah Padang",
            "queryPlace": "Taman Lembah Padang, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Desa Baiduri",
            "queryPlace": "Taman Desa Baiduri, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Temiang Murni",
            "queryPlace": "Taman Temiang Murni, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Bunga Mawar",
            "queryPlace": "Taman Bunga Mawar, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Orkid",
            "queryPlace": "Taman Orkid, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Nilam Sari",
            "queryPlace": "Taman Nilam Sari, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Pertama Indah",
            "queryPlace": "Taman Pertama Indah, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Desa",
            "queryPlace": "Taman Desa, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Khalidi",
            "queryPlace": "Taman Khalidi, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Mas Jaya",
            "queryPlace": "Taman Mas Jaya, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Indah (Muar)",
            "queryPlace": "Taman Indah, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Junid Perdana",
            "queryPlace": "Taman Junid Perdana, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Sri Maharani",
            "queryPlace": "Taman Sri Maharani, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Sri Terap",
            "queryPlace": "Taman Sri Terap, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Tanjung Gading",
            "queryPlace": "Taman Tanjung Gading, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Seri Mewah",
            "queryPlace": "Taman Seri Mewah, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Sabak Awor",
            "queryPlace": "Taman Sabak Awor, Bandar Maharani, Johor"
          },
          {
            "name": "Taman Sri Tanjung",
            "queryPlace": "Taman Sri Tanjung, Bandar Maharani, Johor"
          }
        ]
      },
      {
        "id": "johor_muar_sungai_abong",
        "name": "Sungai Abong",
        "fullName": "Sungai Abong",
        "queryPlace": "Sungai Abong, Muar, Johor",
        "tamans": [
          {
            "name": "Taman Sungai Abong",
            "queryPlace": "Taman Sungai Abong, Sungai Abong, Johor"
          },
          {
            "name": "Taman Sungai Abong Indah",
            "queryPlace": "Taman Sungai Abong Indah, Sungai Abong, Johor"
          },
          {
            "name": "Taman Sungai Abong Mulia",
            "queryPlace": "Taman Sungai Abong Mulia, Sungai Abong, Johor"
          },
          {
            "name": "Taman Sri Sungai Abong",
            "queryPlace": "Taman Sri Sungai Abong, Sungai Abong, Johor"
          },
          {
            "name": "Taman Damai (Sungai Abong)",
            "queryPlace": "Taman Damai, Sungai Abong, Johor"
          },
          {
            "name": "Taman Perdana (Sungai Abong)",
            "queryPlace": "Taman Perdana, Sungai Abong, Johor"
          }
        ]
      },
      {
        "id": "johor_muar_bakri_bukit_bakri",
        "name": "Bakri / Bukit Bakri",
        "fullName": "Bakri / Bukit Bakri",
        "queryPlace": "Bakri / Bukit Bakri, Muar, Johor",
        "tamans": [
          {
            "name": "Taman Sri Bakri (Fasa 1, 2, 3)",
            "queryPlace": "Taman Sri Bakri, Bakri / Bukit Bakri, Johor"
          },
          {
            "name": "Taman Bakri Indah",
            "queryPlace": "Taman Bakri Indah, Bakri / Bukit Bakri, Johor"
          },
          {
            "name": "Taman Bakri Jaya",
            "queryPlace": "Taman Bakri Jaya, Bakri / Bukit Bakri, Johor"
          },
          {
            "name": "Taman Bakri Mulia",
            "queryPlace": "Taman Bakri Mulia, Bakri / Bukit Bakri, Johor"
          },
          {
            "name": "Taman Bakri Utama",
            "queryPlace": "Taman Bakri Utama, Bakri / Bukit Bakri, Johor"
          },
          {
            "name": "Taman Bakri Maju",
            "queryPlace": "Taman Bakri Maju, Bakri / Bukit Bakri, Johor"
          },
          {
            "name": "Taman Desa Bakri",
            "queryPlace": "Taman Desa Bakri, Bakri / Bukit Bakri, Johor"
          },
          {
            "name": "Taman Bakri Harmoni",
            "queryPlace": "Taman Bakri Harmoni, Bakri / Bukit Bakri, Johor"
          },
          {
            "name": "Taman Bukit Bakri",
            "queryPlace": "Taman Bukit Bakri, Bakri / Bukit Bakri, Johor"
          },
          {
            "name": "Taman Bakri Makmur",
            "queryPlace": "Taman Bakri Makmur, Bakri / Bukit Bakri, Johor"
          }
        ]
      },
      {
        "id": "johor_muar_bukit_pasir",
        "name": "Bukit Pasir",
        "fullName": "Bukit Pasir (Muar)",
        "queryPlace": "Bukit Pasir, Muar, Johor",
        "tamans": [
          {
            "name": "Taman Bukit Pasir",
            "queryPlace": "Taman Bukit Pasir, Bukit Pasir, Johor"
          },
          {
            "name": "Taman Seri Pasir",
            "queryPlace": "Taman Seri Pasir, Bukit Pasir, Johor"
          },
          {
            "name": "Taman Pasir Murni",
            "queryPlace": "Taman Pasir Murni, Bukit Pasir, Johor"
          },
          {
            "name": "Taman Pasir Emas",
            "queryPlace": "Taman Pasir Emas, Bukit Pasir, Johor"
          },
          {
            "name": "Taman Bintang Bukit Pasir",
            "queryPlace": "Taman Bintang Bukit Pasir, Bukit Pasir, Johor"
          }
        ]
      },
      {
        "id": "johor_muar_pagoh",
        "name": "Pagoh",
        "fullName": "Pagoh & Bandar Universiti Pagoh",
        "queryPlace": "Pagoh, Muar, Johor",
        "tamans": [
          {
            "name": "Bandar Universiti Pagoh (BUP)",
            "queryPlace": "Bandar Universiti Pagoh, Pagoh, Johor"
          },
          {
            "name": "Taman Pagoh Jaya",
            "queryPlace": "Taman Pagoh Jaya, Pagoh, Johor"
          },
          {
            "name": "Taman Seri Pagoh",
            "queryPlace": "Taman Seri Pagoh, Pagoh, Johor"
          },
          {
            "name": "Taman Pagoh Indah",
            "queryPlace": "Taman Pagoh Indah, Pagoh, Johor"
          },
          {
            "name": "Taman Harmoni Pagoh",
            "queryPlace": "Taman Harmoni Pagoh, Pagoh, Johor"
          },
          {
            "name": "Pekan Pagoh",
            "queryPlace": "Pekan Pagoh, Pagoh, Johor"
          }
        ]
      },
      {
        "id": "johor_muar_parit_jawa",
        "name": "Parit Jawa",
        "fullName": "Parit Jawa & Padang",
        "queryPlace": "Parit Jawa, Muar, Johor",
        "tamans": [
          {
            "name": "Taman Parit Jawa",
            "queryPlace": "Taman Parit Jawa, Parit Jawa, Johor"
          },
          {
            "name": "Taman Jawa Indah",
            "queryPlace": "Taman Jawa Indah, Parit Jawa, Johor"
          },
          {
            "name": "Taman Padang Indah",
            "queryPlace": "Taman Padang Indah, Parit Jawa, Johor"
          },
          {
            "name": "Taman Seri Menanti",
            "queryPlace": "Taman Seri Menanti, Parit Jawa, Johor"
          },
          {
            "name": "Taman Seri Jaya (Parit Jawa)",
            "queryPlace": "Taman Seri Jaya, Parit Jawa, Johor"
          },
          {
            "name": "Residensi Bangsa Johor (RsBJ) Parit Jawa",
            "queryPlace": "Residensi Bangsa Johor  Parit Jawa, Parit Jawa, Johor"
          }
        ]
      },
      {
        "id": "johor_muar_sungai_balang",
        "name": "Sungai Balang",
        "fullName": "Sungai Balang",
        "queryPlace": "Sungai Balang, Muar, Johor",
        "tamans": [
          {
            "name": "Taman Sungai Balang",
            "queryPlace": "Taman Sungai Balang, Sungai Balang, Johor"
          },
          {
            "name": "Taman Balang Baru",
            "queryPlace": "Taman Balang Baru, Sungai Balang, Johor"
          },
          {
            "name": "Residensi Bangsa Johor (RsBJ) Parit Nipah Laut",
            "queryPlace": "Residensi Bangsa Johor  Parit Nipah Laut, Sungai Balang, Johor"
          }
        ]
      },
      {
        "id": "johor_muar_panchor",
        "name": "Panchor",
        "fullName": "Panchor & Lenga",
        "queryPlace": "Panchor, Muar, Johor",
        "tamans": [
          {
            "name": "Taman Panchor Jaya",
            "queryPlace": "Taman Panchor Jaya, Panchor, Johor"
          },
          {
            "name": "Taman Seri Panchor",
            "queryPlace": "Taman Seri Panchor, Panchor, Johor"
          },
          {
            "name": "Taman Lenga Indah",
            "queryPlace": "Taman Lenga Indah, Panchor, Johor"
          },
          {
            "name": "Pekan Lenga",
            "queryPlace": "Pekan Lenga, Panchor, Johor"
          }
        ]
      }
    ]
  },
  {
    "id": "johor_pontian",
    "num": 6,
    "name": "Pontian",
    "state": "Johor",
    "towns": [
      {
        "id": "johor_pontian_pontian_kechil",
        "name": "Pontian Kechil",
        "fullName": "Pontian Kechil (Pontian Town Core)",
        "queryPlace": "Pontian Kechil, Pontian, Johor",
        "tamans": [
          {
            "name": "Taman Rakyat Pontian",
            "queryPlace": "Taman Rakyat Pontian, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Pontian Jaya",
            "queryPlace": "Taman Pontian Jaya, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Kota Emas",
            "queryPlace": "Taman Kota Emas, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Mawar",
            "queryPlace": "Taman Mawar, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Cahaya",
            "queryPlace": "Taman Cahaya, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Nilam",
            "queryPlace": "Taman Nilam, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Bakek Jaya",
            "queryPlace": "Taman Bakek Jaya, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Sri Maju",
            "queryPlace": "Taman Sri Maju, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Desa Sri Perhentian",
            "queryPlace": "Taman Desa Sri Perhentian, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Desa Harta Ria",
            "queryPlace": "Taman Desa Harta Ria, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Pontian Utama",
            "queryPlace": "Taman Pontian Utama, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Pontian Perdana",
            "queryPlace": "Taman Pontian Perdana, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Megah (Pontian)",
            "queryPlace": "Taman Megah, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Sri Sutera",
            "queryPlace": "Taman Sri Sutera, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Nong Chik (Pontian)",
            "queryPlace": "Taman Nong Chik, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Saujana",
            "queryPlace": "Taman Saujana, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Jasa",
            "queryPlace": "Taman Jasa, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Rimba",
            "queryPlace": "Taman Rimba, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Anggerik",
            "queryPlace": "Taman Anggerik, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Sri Pinang",
            "queryPlace": "Taman Sri Pinang, Pontian Kechil, Johor"
          },
          {
            "name": "Taman Perindustrian Maju",
            "queryPlace": "Taman Perindustrian Maju, Pontian Kechil, Johor"
          }
        ]
      },
      {
        "id": "johor_pontian_pekan_nanas",
        "name": "Pekan Nanas",
        "fullName": "Pekan Nanas",
        "queryPlace": "Pekan Nanas, Pontian, Johor",
        "tamans": [
          {
            "name": "Taman Sri Bahagia",
            "queryPlace": "Taman Sri Bahagia, Pekan Nanas, Johor"
          },
          {
            "name": "Taman Sri Pekan Nanas",
            "queryPlace": "Taman Sri Pekan Nanas, Pekan Nanas, Johor"
          },
          {
            "name": "Taman Tuah",
            "queryPlace": "Taman Tuah, Pekan Nanas, Johor"
          },
          {
            "name": "Taman Baru Utama",
            "queryPlace": "Taman Baru Utama, Pekan Nanas, Johor"
          },
          {
            "name": "Taman Seri Damansara",
            "queryPlace": "Taman Seri Damansara, Pekan Nanas, Johor"
          },
          {
            "name": "Taman Emas Merah",
            "queryPlace": "Taman Emas Merah, Pekan Nanas, Johor"
          },
          {
            "name": "Taman Sri Jaya (Pekan Nanas)",
            "queryPlace": "Taman Sri Jaya, Pekan Nanas, Johor"
          },
          {
            "name": "Taman Sri Sentosa (Pekan Nanas)",
            "queryPlace": "Taman Sri Sentosa, Pekan Nanas, Johor"
          },
          {
            "name": "Taman Bintang",
            "queryPlace": "Taman Bintang, Pekan Nanas, Johor"
          },
          {
            "name": "Taman Mewah (Pekan Nanas)",
            "queryPlace": "Taman Mewah, Pekan Nanas, Johor"
          },
          {
            "name": "Taman Kiara",
            "queryPlace": "Taman Kiara, Pekan Nanas, Johor"
          },
          {
            "name": "Taman Sentosa",
            "queryPlace": "Taman Sentosa, Pekan Nanas, Johor"
          },
          {
            "name": "Pekan Nenas Industrial Park",
            "queryPlace": "Pekan Nenas Industrial Park, Pekan Nanas, Johor"
          }
        ]
      },
      {
        "id": "johor_pontian_benut",
        "name": "Benut",
        "fullName": "Benut",
        "queryPlace": "Benut, Pontian, Johor",
        "tamans": [
          {
            "name": "Bandar Baru Benut",
            "queryPlace": "Bandar Baru Benut, Benut, Johor"
          },
          {
            "name": "Taman Mekar (Benut)",
            "queryPlace": "Taman Mekar, Benut, Johor"
          },
          {
            "name": "Taman Sri Benut",
            "queryPlace": "Taman Sri Benut, Benut, Johor"
          },
          {
            "name": "Taman Benut Jaya",
            "queryPlace": "Taman Benut Jaya, Benut, Johor"
          },
          {
            "name": "Taman Muhibbah Benut",
            "queryPlace": "Taman Muhibbah Benut, Benut, Johor"
          },
          {
            "name": "Taman Permata Benut",
            "queryPlace": "Taman Permata Benut, Benut, Johor"
          },
          {
            "name": "Taman Harmoni Benut",
            "queryPlace": "Taman Harmoni Benut, Benut, Johor"
          }
        ]
      },
      {
        "id": "johor_pontian_kukup",
        "name": "Kukup",
        "fullName": "Kukup",
        "queryPlace": "Kukup, Pontian, Johor",
        "tamans": [
          {
            "name": "Taman Kukup Indah",
            "queryPlace": "Taman Kukup Indah, Kukup, Johor"
          },
          {
            "name": "Taman Permata Kukup",
            "queryPlace": "Taman Permata Kukup, Kukup, Johor"
          },
          {
            "name": "Taman Sri Kukup",
            "queryPlace": "Taman Sri Kukup, Kukup, Johor"
          },
          {
            "name": "Pekan Penerok",
            "queryPlace": "Pekan Penerok, Kukup, Johor"
          },
          {
            "name": "Kampung Nelayan Air Masin",
            "queryPlace": "Kampung Nelayan Air Masin, Kukup, Johor"
          },
          {
            "name": "Kampung Nelayan Kukup Laut",
            "queryPlace": "Kampung Nelayan Kukup Laut, Kukup, Johor"
          }
        ]
      },
      {
        "id": "johor_pontian_ayer_baloi",
        "name": "Ayer Baloi",
        "fullName": "Ayer Baloi",
        "queryPlace": "Ayer Baloi, Pontian, Johor",
        "tamans": [
          {
            "name": "Taman Ayer Baloi",
            "queryPlace": "Taman Ayer Baloi, Ayer Baloi, Johor"
          },
          {
            "name": "Taman Sri Baloi",
            "queryPlace": "Taman Sri Baloi, Ayer Baloi, Johor"
          },
          {
            "name": "Taman Murni (Ayer Baloi)",
            "queryPlace": "Taman Murni, Ayer Baloi, Johor"
          }
        ]
      },
      {
        "id": "johor_pontian_rambah",
        "name": "Rambah",
        "fullName": "Rambah & Serkat",
        "queryPlace": "Rambah, Pontian, Johor",
        "tamans": [
          {
            "name": "Taman Rambah",
            "queryPlace": "Taman Rambah, Rambah, Johor"
          },
          {
            "name": "Taman Sri Rambah",
            "queryPlace": "Taman Sri Rambah, Rambah, Johor"
          },
          {
            "name": "Pekan Serkat (Gateway to Tanjung Piai)",
            "queryPlace": "Pekan Serkat, Rambah, Johor"
          }
        ]
      }
    ]
  },
  {
    "id": "johor_kota_tinggi",
    "num": 7,
    "name": "Kota Tinggi",
    "state": "Johor",
    "towns": [
      {
        "id": "johor_kota_tinggi_kota_tinggi",
        "name": "Kota Tinggi",
        "fullName": "Kota Tinggi Town Core (MDKT)",
        "queryPlace": "Kota Tinggi, Kota Tinggi, Johor",
        "tamans": [
          {
            "name": "Taman Kota Jaya (Fasa 1 & 2)",
            "queryPlace": "Taman Kota Jaya, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Sri Lalang",
            "queryPlace": "Taman Sri Lalang, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Daiman Jaya",
            "queryPlace": "Taman Daiman Jaya, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Scientex Kota Tinggi",
            "queryPlace": "Taman Scientex Kota Tinggi, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Ahmad Perang",
            "queryPlace": "Taman Ahmad Perang, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Guru",
            "queryPlace": "Taman Guru, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Hijrah",
            "queryPlace": "Taman Hijrah, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Laksamana",
            "queryPlace": "Taman Laksamana, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Mawai Jaya",
            "queryPlace": "Taman Mawai Jaya, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Medan Jaya",
            "queryPlace": "Taman Medan Jaya, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Kota Merdesa",
            "queryPlace": "Taman Kota Merdesa, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Kemang",
            "queryPlace": "Taman Kemang, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Kota Mas",
            "queryPlace": "Taman Kota Mas, Kota Tinggi, Johor"
          },
          {
            "name": "Taman YPJ",
            "queryPlace": "Taman YPJ, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Berjaya",
            "queryPlace": "Taman Berjaya, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Bendahara",
            "queryPlace": "Taman Bendahara, Kota Tinggi, Johor"
          },
          {
            "name": "Taman Seri Saujana",
            "queryPlace": "Taman Seri Saujana, Kota Tinggi, Johor"
          }
        ]
      },
      {
        "id": "johor_kota_tinggi_bandar_penawar",
        "name": "Bandar Penawar",
        "fullName": "Bandar Penawar & Desaru (MPP)",
        "queryPlace": "Bandar Penawar, Kota Tinggi, Johor",
        "tamans": [
          {
            "name": "Bandar Penawar Core",
            "queryPlace": "Bandar Penawar Core, Bandar Penawar, Johor"
          },
          {
            "name": "Taman Desaru Utama",
            "queryPlace": "Taman Desaru Utama, Bandar Penawar, Johor"
          },
          {
            "name": "Taman Desaru Damai",
            "queryPlace": "Taman Desaru Damai, Bandar Penawar, Johor"
          },
          {
            "name": "Taman Penawar Harmoni",
            "queryPlace": "Taman Penawar Harmoni, Bandar Penawar, Johor"
          },
          {
            "name": "Taman Sri Penawar",
            "queryPlace": "Taman Sri Penawar, Bandar Penawar, Johor"
          },
          {
            "name": "Taman Desaru Villa",
            "queryPlace": "Taman Desaru Villa, Bandar Penawar, Johor"
          },
          {
            "name": "Taman Bayu Damai",
            "queryPlace": "Taman Bayu Damai, Bandar Penawar, Johor"
          },
          {
            "name": "Taman Harmoni (Bandar Penawar)",
            "queryPlace": "Taman Harmoni, Bandar Penawar, Johor"
          },
          {
            "name": "Taman Nilam Penawar",
            "queryPlace": "Taman Nilam Penawar, Bandar Penawar, Johor"
          },
          {
            "name": "Desaru Coast Resort Corridor",
            "queryPlace": "Desaru Coast Resort Corridor, Bandar Penawar, Johor"
          }
        ]
      },
      {
        "id": "johor_kota_tinggi_pengerang",
        "name": "Pengerang",
        "fullName": "Pengerang & Sungai Rengit (MPP)",
        "queryPlace": "Pengerang, Kota Tinggi, Johor",
        "tamans": [
          {
            "name": "Taman Sungai Rengit",
            "queryPlace": "Taman Sungai Rengit, Pengerang, Johor"
          },
          {
            "name": "Taman Bayu Sutera",
            "queryPlace": "Taman Bayu Sutera, Pengerang, Johor"
          },
          {
            "name": "Taman Pengerang Jaya",
            "queryPlace": "Taman Pengerang Jaya, Pengerang, Johor"
          },
          {
            "name": "Pekan Sungai Rengit",
            "queryPlace": "Pekan Sungai Rengit, Pengerang, Johor"
          },
          {
            "name": "Pekan Teluk Ramunia",
            "queryPlace": "Pekan Teluk Ramunia, Pengerang, Johor"
          },
          {
            "name": "Pekan Tanjung Pengelih",
            "queryPlace": "Pekan Tanjung Pengelih, Pengerang, Johor"
          },
          {
            "name": "Pengerang Integrated Petroleum Complex (PIPC) Enclave",
            "queryPlace": "Pengerang Integrated Petroleum Complex  Enclave, Pengerang, Johor"
          }
        ]
      },
      {
        "id": "johor_kota_tinggi_bandar_tenggara",
        "name": "Bandar Tenggara",
        "fullName": "Bandar Tenggara",
        "queryPlace": "Bandar Tenggara, Kota Tinggi, Johor",
        "tamans": [
          {
            "name": "Taman Tenggara",
            "queryPlace": "Taman Tenggara, Bandar Tenggara, Johor"
          },
          {
            "name": "Taman Sayong Indah",
            "queryPlace": "Taman Sayong Indah, Bandar Tenggara, Johor"
          },
          {
            "name": "Taman Sri Tenggara",
            "queryPlace": "Taman Sri Tenggara, Bandar Tenggara, Johor"
          },
          {
            "name": "FELDA Pengeli Wetan",
            "queryPlace": "FELDA Pengeli Wetan, Bandar Tenggara, Johor"
          }
        ]
      },
      {
        "id": "johor_kota_tinggi_sedili",
        "name": "Sedili",
        "fullName": "Sedili (Kuala Sedili, Sedili Besar, Sedili Kechil)",
        "queryPlace": "Sedili, Kota Tinggi, Johor",
        "tamans": [
          {
            "name": "Taman Sedili",
            "queryPlace": "Taman Sedili, Sedili, Johor"
          },
          {
            "name": "Taman Kota Besar",
            "queryPlace": "Taman Kota Besar, Sedili, Johor"
          },
          {
            "name": "Pekan Kuala Sedili",
            "queryPlace": "Pekan Kuala Sedili, Sedili, Johor"
          },
          {
            "name": "Kampung Sedili Besar",
            "queryPlace": "Kampung Sedili Besar, Sedili, Johor"
          },
          {
            "name": "Kampung Sedili Kechil",
            "queryPlace": "Kampung Sedili Kechil, Sedili, Johor"
          }
        ]
      },
      {
        "id": "johor_kota_tinggi_teluk_sengat",
        "name": "Teluk Sengat",
        "fullName": "Teluk Sengat",
        "queryPlace": "Teluk Sengat, Kota Tinggi, Johor",
        "tamans": [
          {
            "name": "Taman Teluk Sengat",
            "queryPlace": "Taman Teluk Sengat, Teluk Sengat, Johor"
          },
          {
            "name": "Kampung Teluk Sengat",
            "queryPlace": "Kampung Teluk Sengat, Teluk Sengat, Johor"
          }
        ]
      }
    ]
  },
  {
    "id": "johor_segamat",
    "num": 8,
    "name": "Segamat",
    "state": "Johor",
    "towns": [
      {
        "id": "johor_segamat_bandar_segamat",
        "name": "Bandar Segamat",
        "fullName": "Bandar Segamat Core (MPS)",
        "queryPlace": "Bandar Segamat, Segamat, Johor",
        "tamans": [
          {
            "name": "Bandar Putra Segamat (IOI)",
            "queryPlace": "Bandar Putra Segamat, Bandar Segamat, Johor"
          },
          {
            "name": "Bandar Segamat Baru",
            "queryPlace": "Bandar Segamat Baru, Bandar Segamat, Johor"
          },
          {
            "name": "Bandar IOI Segamat",
            "queryPlace": "Bandar IOI Segamat, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Yayasan",
            "queryPlace": "Taman Yayasan, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Utama",
            "queryPlace": "Taman Utama, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Tan Leng Ann",
            "queryPlace": "Taman Tan Leng Ann, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Segar",
            "queryPlace": "Taman Segar, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Astakajaya",
            "queryPlace": "Taman Astakajaya, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Segamat Jaya",
            "queryPlace": "Taman Segamat Jaya, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Cempaka",
            "queryPlace": "Taman Cempaka, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Kenari Indah",
            "queryPlace": "Taman Kenari Indah, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Makmur",
            "queryPlace": "Taman Makmur, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Bintang Indah",
            "queryPlace": "Taman Bintang Indah, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Pemuda",
            "queryPlace": "Taman Pemuda, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Pelangi (Segamat)",
            "queryPlace": "Taman Pelangi, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Sri Wira",
            "queryPlace": "Taman Sri Wira, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Bukit Baru",
            "queryPlace": "Taman Bukit Baru, Bandar Segamat, Johor"
          },
          {
            "name": "Taman Gemereh",
            "queryPlace": "Taman Gemereh, Bandar Segamat, Johor"
          }
        ]
      },
      {
        "id": "johor_segamat_labis",
        "name": "Labis",
        "fullName": "Labis (MDL)",
        "queryPlace": "Labis, Segamat, Johor",
        "tamans": [
          {
            "name": "Taman Asia Timur",
            "queryPlace": "Taman Asia Timur, Labis, Johor"
          },
          {
            "name": "Taman Bandar Jaya",
            "queryPlace": "Taman Bandar Jaya, Labis, Johor"
          },
          {
            "name": "Taman Indah (Labis)",
            "queryPlace": "Taman Indah, Labis, Johor"
          },
          {
            "name": "Taman Mewah",
            "queryPlace": "Taman Mewah, Labis, Johor"
          },
          {
            "name": "Labis Park",
            "queryPlace": "Labis Park, Labis, Johor"
          },
          {
            "name": "Taman Eng Peng",
            "queryPlace": "Taman Eng Peng, Labis, Johor"
          },
          {
            "name": "Taman Ria",
            "queryPlace": "Taman Ria, Labis, Johor"
          },
          {
            "name": "Taman Sentosa (Labis)",
            "queryPlace": "Taman Sentosa, Labis, Johor"
          },
          {
            "name": "Taman Soon Cheong",
            "queryPlace": "Taman Soon Cheong, Labis, Johor"
          },
          {
            "name": "Taman Sri Berlian",
            "queryPlace": "Taman Sri Berlian, Labis, Johor"
          },
          {
            "name": "Taman Wijaya",
            "queryPlace": "Taman Wijaya, Labis, Johor"
          },
          {
            "name": "Taman Sri Jaya",
            "queryPlace": "Taman Sri Jaya, Labis, Johor"
          },
          {
            "name": "Taman Daya (Labis)",
            "queryPlace": "Taman Daya, Labis, Johor"
          },
          {
            "name": "Taman Gunung Emas",
            "queryPlace": "Taman Gunung Emas, Labis, Johor"
          },
          {
            "name": "Taman Sejati",
            "queryPlace": "Taman Sejati, Labis, Johor"
          },
          {
            "name": "Taman Labis Jaya",
            "queryPlace": "Taman Labis Jaya, Labis, Johor"
          },
          {
            "name": "Taman Suria",
            "queryPlace": "Taman Suria, Labis, Johor"
          },
          {
            "name": "Taman Sri Emas",
            "queryPlace": "Taman Sri Emas, Labis, Johor"
          },
          {
            "name": "Taman Bintang Jaya",
            "queryPlace": "Taman Bintang Jaya, Labis, Johor"
          },
          {
            "name": "Taman Pelangi (Labis)",
            "queryPlace": "Taman Pelangi, Labis, Johor"
          },
          {
            "name": "Taman Orkid Baru",
            "queryPlace": "Taman Orkid Baru, Labis, Johor"
          },
          {
            "name": "Taman Perwira",
            "queryPlace": "Taman Perwira, Labis, Johor"
          },
          {
            "name": "Taman Perling (Labis)",
            "queryPlace": "Taman Perling, Labis, Johor"
          },
          {
            "name": "Taman Wawasan & Taman Wawasan 1",
            "queryPlace": "Taman Wawasan & Taman Wawasan 1, Labis, Johor"
          },
          {
            "name": "Taman Wira & Taman Wira 2",
            "queryPlace": "Taman Wira & Taman Wira 2, Labis, Johor"
          },
          {
            "name": "Taman Sri Tenang",
            "queryPlace": "Taman Sri Tenang, Labis, Johor"
          },
          {
            "name": "Taman Sri Bahagia",
            "queryPlace": "Taman Sri Bahagia, Labis, Johor"
          },
          {
            "name": "Taman Sinar Emas",
            "queryPlace": "Taman Sinar Emas, Labis, Johor"
          },
          {
            "name": "Taman Sri Bayu",
            "queryPlace": "Taman Sri Bayu, Labis, Johor"
          },
          {
            "name": "Taman Sri Aman",
            "queryPlace": "Taman Sri Aman, Labis, Johor"
          },
          {
            "name": "Taman Berjaya & Taman Berjaya 2",
            "queryPlace": "Taman Berjaya & Taman Berjaya 2, Labis, Johor"
          },
          {
            "name": "Taman Ah Pong",
            "queryPlace": "Taman Ah Pong, Labis, Johor"
          },
          {
            "name": "Taman Labis Indah",
            "queryPlace": "Taman Labis Indah, Labis, Johor"
          },
          {
            "name": "Taman Lagenda",
            "queryPlace": "Taman Lagenda, Labis, Johor"
          },
          {
            "name": "Taman Maju Jaya",
            "queryPlace": "Taman Maju Jaya, Labis, Johor"
          }
        ]
      },
      {
        "id": "johor_segamat_buloh_kasap",
        "name": "Buloh Kasap",
        "fullName": "Buloh Kasap",
        "queryPlace": "Buloh Kasap, Segamat, Johor",
        "tamans": [
          {
            "name": "Taman Yayasan (Buloh Kasap section)",
            "queryPlace": "Taman Yayasan, Buloh Kasap, Johor"
          },
          {
            "name": "Taman Tasik Sejati",
            "queryPlace": "Taman Tasik Sejati, Buloh Kasap, Johor"
          },
          {
            "name": "Taman Segamat Jaya (Buloh Kasap)",
            "queryPlace": "Taman Segamat Jaya, Buloh Kasap, Johor"
          },
          {
            "name": "Taman Mewah (Buloh Kasap)",
            "queryPlace": "Taman Mewah, Buloh Kasap, Johor"
          },
          {
            "name": "Taman Stesen",
            "queryPlace": "Taman Stesen, Buloh Kasap, Johor"
          },
          {
            "name": "Taman Mutiara Maju",
            "queryPlace": "Taman Mutiara Maju, Buloh Kasap, Johor"
          },
          {
            "name": "Taman Buloh Kasap",
            "queryPlace": "Taman Buloh Kasap, Buloh Kasap, Johor"
          }
        ]
      },
      {
        "id": "johor_segamat_jementah",
        "name": "Jementah",
        "fullName": "Jementah",
        "queryPlace": "Jementah, Segamat, Johor",
        "tamans": [
          {
            "name": "Taman Jementah Baru",
            "queryPlace": "Taman Jementah Baru, Jementah, Johor"
          },
          {
            "name": "Taman Tropika",
            "queryPlace": "Taman Tropika, Jementah, Johor"
          },
          {
            "name": "Taman Molek (Jementah)",
            "queryPlace": "Taman Molek, Jementah, Johor"
          },
          {
            "name": "Taman Cempaka",
            "queryPlace": "Taman Cempaka, Jementah, Johor"
          },
          {
            "name": "Taman Sri Mewah",
            "queryPlace": "Taman Sri Mewah, Jementah, Johor"
          },
          {
            "name": "Taman Jementah Jaya",
            "queryPlace": "Taman Jementah Jaya, Jementah, Johor"
          },
          {
            "name": "Taman Ledang",
            "queryPlace": "Taman Ledang, Jementah, Johor"
          },
          {
            "name": "Taman Melodi",
            "queryPlace": "Taman Melodi, Jementah, Johor"
          },
          {
            "name": "Taman Bahtera",
            "queryPlace": "Taman Bahtera, Jementah, Johor"
          },
          {
            "name": "Taman Ria (Jementah)",
            "queryPlace": "Taman Ria, Jementah, Johor"
          },
          {
            "name": "Taman Jakas",
            "queryPlace": "Taman Jakas, Jementah, Johor"
          },
          {
            "name": "Taman Harmoni (Jementah)",
            "queryPlace": "Taman Harmoni, Jementah, Johor"
          },
          {
            "name": "Taman Sri Ganang",
            "queryPlace": "Taman Sri Ganang, Jementah, Johor"
          },
          {
            "name": "Taman Intan (Jementah)",
            "queryPlace": "Taman Intan, Jementah, Johor"
          },
          {
            "name": "Taman Jaya",
            "queryPlace": "Taman Jaya, Jementah, Johor"
          }
        ]
      },
      {
        "id": "johor_segamat_chaah",
        "name": "Chaah",
        "fullName": "Chaah",
        "queryPlace": "Chaah, Segamat, Johor",
        "tamans": [
          {
            "name": "Taman Chaah Baru",
            "queryPlace": "Taman Chaah Baru, Chaah, Johor"
          },
          {
            "name": "Taman Muhibbah Jaya",
            "queryPlace": "Taman Muhibbah Jaya, Chaah, Johor"
          },
          {
            "name": "Taman Seri Sinaran",
            "queryPlace": "Taman Seri Sinaran, Chaah, Johor"
          },
          {
            "name": "Taman Sri Chaah",
            "queryPlace": "Taman Sri Chaah, Chaah, Johor"
          },
          {
            "name": "Taman Damai Jaya 2",
            "queryPlace": "Taman Damai Jaya 2, Chaah, Johor"
          },
          {
            "name": "Taman Nesa Chaah",
            "queryPlace": "Taman Nesa Chaah, Chaah, Johor"
          },
          {
            "name": "Taman Sentosa (Chaah)",
            "queryPlace": "Taman Sentosa, Chaah, Johor"
          },
          {
            "name": "Taman Sri Setia",
            "queryPlace": "Taman Sri Setia, Chaah, Johor"
          },
          {
            "name": "Desa Temu Jodoh",
            "queryPlace": "Desa Temu Jodoh, Chaah, Johor"
          }
        ]
      },
      {
        "id": "johor_segamat_bekok",
        "name": "Bekok",
        "fullName": "Bekok (MDL)",
        "queryPlace": "Bekok, Segamat, Johor",
        "tamans": [
          {
            "name": "Taman Sri Bekok",
            "queryPlace": "Taman Sri Bekok, Bekok, Johor"
          },
          {
            "name": "Taman Skim Bekok",
            "queryPlace": "Taman Skim Bekok, Bekok, Johor"
          },
          {
            "name": "Taman Sri Mahkota",
            "queryPlace": "Taman Sri Mahkota, Bekok, Johor"
          },
          {
            "name": "Taman Berjaya (Bekok)",
            "queryPlace": "Taman Berjaya, Bekok, Johor"
          },
          {
            "name": "Taman Mutiara (Bekok)",
            "queryPlace": "Taman Mutiara, Bekok, Johor"
          },
          {
            "name": "Taman Wijaya (Bekok)",
            "queryPlace": "Taman Wijaya, Bekok, Johor"
          }
        ]
      },
      {
        "id": "johor_segamat_batu_anam",
        "name": "Batu Anam",
        "fullName": "Batu Anam",
        "queryPlace": "Batu Anam, Segamat, Johor",
        "tamans": [
          {
            "name": "Taman Sri Alam (1 & 2)",
            "queryPlace": "Taman Sri Alam, Batu Anam, Johor"
          },
          {
            "name": "Taman Permai (Batu Anam)",
            "queryPlace": "Taman Permai, Batu Anam, Johor"
          },
          {
            "name": "Taman Mina",
            "queryPlace": "Taman Mina, Batu Anam, Johor"
          },
          {
            "name": "Taman Bintang-Bintang",
            "queryPlace": "Taman Bintang-Bintang, Batu Anam, Johor"
          },
          {
            "name": "Taman Damai",
            "queryPlace": "Taman Damai, Batu Anam, Johor"
          },
          {
            "name": "Taman Desa India",
            "queryPlace": "Taman Desa India, Batu Anam, Johor"
          },
          {
            "name": "Taman KSM",
            "queryPlace": "Taman KSM, Batu Anam, Johor"
          },
          {
            "name": "Taman Mawar",
            "queryPlace": "Taman Mawar, Batu Anam, Johor"
          },
          {
            "name": "Taman Seri Seruling",
            "queryPlace": "Taman Seri Seruling, Batu Anam, Johor"
          },
          {
            "name": "Taman Seri Cahaya",
            "queryPlace": "Taman Seri Cahaya, Batu Anam, Johor"
          },
          {
            "name": "Taman Seri Emas Jaya",
            "queryPlace": "Taman Seri Emas Jaya, Batu Anam, Johor"
          },
          {
            "name": "Taman Molek Perdana",
            "queryPlace": "Taman Molek Perdana, Batu Anam, Johor"
          }
        ]
      },
      {
        "id": "johor_segamat_tenang_tenang_stesen",
        "name": "Tenang / Tenang Stesen",
        "fullName": "Tenang / Tenang Stesen",
        "queryPlace": "Tenang / Tenang Stesen, Segamat, Johor",
        "tamans": [
          {
            "name": "Taman Sri Tenang",
            "queryPlace": "Taman Sri Tenang, Tenang / Tenang Stesen, Johor"
          },
          {
            "name": "Taman Tenang Jaya",
            "queryPlace": "Taman Tenang Jaya, Tenang / Tenang Stesen, Johor"
          },
          {
            "name": "Kampung Tenang",
            "queryPlace": "Kampung Tenang, Tenang / Tenang Stesen, Johor"
          }
        ]
      }
    ]
  },
  {
    "id": "johor_tangkak",
    "num": 9,
    "name": "Tangkak",
    "state": "Johor",
    "towns": [
      {
        "id": "johor_tangkak_tangkak",
        "name": "Tangkak",
        "fullName": "Tangkak Town Core",
        "queryPlace": "Tangkak, Tangkak, Johor",
        "tamans": [
          {
            "name": "Bandar Baru Tangkak",
            "queryPlace": "Bandar Baru Tangkak, Tangkak, Johor"
          },
          {
            "name": "Taman Delima",
            "queryPlace": "Taman Delima, Tangkak, Johor"
          },
          {
            "name": "Taman Kemajuan",
            "queryPlace": "Taman Kemajuan, Tangkak, Johor"
          },
          {
            "name": "Taman Happy Garden",
            "queryPlace": "Taman Happy Garden, Tangkak, Johor"
          },
          {
            "name": "Taman Bintang",
            "queryPlace": "Taman Bintang, Tangkak, Johor"
          },
          {
            "name": "Taman Ledang Emas",
            "queryPlace": "Taman Ledang Emas, Tangkak, Johor"
          },
          {
            "name": "Taman Tangkak Jaya (Fasa 1 – 7)",
            "queryPlace": "Taman Tangkak Jaya, Tangkak, Johor"
          },
          {
            "name": "Taman Tangkak Perdana",
            "queryPlace": "Taman Tangkak Perdana, Tangkak, Johor"
          },
          {
            "name": "Taman Tangkak 2",
            "queryPlace": "Taman Tangkak 2, Tangkak, Johor"
          },
          {
            "name": "Taman Pelangi (Fasa 1 – 4)",
            "queryPlace": "Taman Pelangi, Tangkak, Johor"
          },
          {
            "name": "Taman Sri Ledang & Taman Sri Ledang Baru",
            "queryPlace": "Taman Sri Ledang & Taman Sri Ledang Baru, Tangkak, Johor"
          },
          {
            "name": "Taman Sialang (Fasa 1 – 5)",
            "queryPlace": "Taman Sialang, Tangkak, Johor"
          },
          {
            "name": "Taman Intan (Fasa 1 & 2)",
            "queryPlace": "Taman Intan, Tangkak, Johor"
          },
          {
            "name": "Taman Mahkota (Fasa 1 – 3)",
            "queryPlace": "Taman Mahkota, Tangkak, Johor"
          },
          {
            "name": "Taman Murni",
            "queryPlace": "Taman Murni, Tangkak, Johor"
          },
          {
            "name": "Taman Sri Tangkak (Fasa 1 & 2)",
            "queryPlace": "Taman Sri Tangkak, Tangkak, Johor"
          },
          {
            "name": "Taman Wawasan",
            "queryPlace": "Taman Wawasan, Tangkak, Johor"
          },
          {
            "name": "Taman Gunung Mas",
            "queryPlace": "Taman Gunung Mas, Tangkak, Johor"
          },
          {
            "name": "Taman Kenangan",
            "queryPlace": "Taman Kenangan, Tangkak, Johor"
          },
          {
            "name": "Taman Tasik Ria",
            "queryPlace": "Taman Tasik Ria, Tangkak, Johor"
          },
          {
            "name": "Taman Ayer Molek (1 & 2)",
            "queryPlace": "Taman Ayer Molek, Tangkak, Johor"
          },
          {
            "name": "Taman Damai (1 & 2)",
            "queryPlace": "Taman Damai, Tangkak, Johor"
          },
          {
            "name": "Taman Bekoh Permai",
            "queryPlace": "Taman Bekoh Permai, Tangkak, Johor"
          },
          {
            "name": "Taman Industri Payamas",
            "queryPlace": "Taman Industri Payamas, Tangkak, Johor"
          },
          {
            "name": "Taman Solok Jaya",
            "queryPlace": "Taman Solok Jaya, Tangkak, Johor"
          },
          {
            "name": "Taman Sri Nilam",
            "queryPlace": "Taman Sri Nilam, Tangkak, Johor"
          }
        ]
      },
      {
        "id": "johor_tangkak_bukit_gambir",
        "name": "Bukit Gambir",
        "fullName": "Bukit Gambir",
        "queryPlace": "Bukit Gambir, Tangkak, Johor",
        "tamans": [
          {
            "name": "Bandar Baru Bukit Gambir",
            "queryPlace": "Bandar Baru Bukit Gambir, Bukit Gambir, Johor"
          },
          {
            "name": "Taman Gambir Perdana",
            "queryPlace": "Taman Gambir Perdana, Bukit Gambir, Johor"
          },
          {
            "name": "Taman Desa 2 (Pekan Bukit Gambir)",
            "queryPlace": "Taman Desa 2, Bukit Gambir, Johor"
          },
          {
            "name": "Taman Melor",
            "queryPlace": "Taman Melor, Bukit Gambir, Johor"
          },
          {
            "name": "Taman Mulia",
            "queryPlace": "Taman Mulia, Bukit Gambir, Johor"
          },
          {
            "name": "Taman Cempaka (Bukit Gambir)",
            "queryPlace": "Taman Cempaka, Bukit Gambir, Johor"
          },
          {
            "name": "Taman Jaya Bukit Gambir",
            "queryPlace": "Taman Jaya Bukit Gambir, Bukit Gambir, Johor"
          }
        ]
      },
      {
        "id": "johor_tangkak_sungai_mati",
        "name": "Sungai Mati",
        "fullName": "Sungai Mati & Serom",
        "queryPlace": "Sungai Mati, Tangkak, Johor",
        "tamans": [
          {
            "name": "Taman Serom Utama & Taman Serom Utama 2",
            "queryPlace": "Taman Serom Utama & Taman Serom Utama 2, Sungai Mati, Johor"
          },
          {
            "name": "Taman Serom 1 & Taman Serom 2",
            "queryPlace": "Taman Serom 1 & Taman Serom 2, Sungai Mati, Johor"
          },
          {
            "name": "Taman Serom Baru",
            "queryPlace": "Taman Serom Baru, Sungai Mati, Johor"
          },
          {
            "name": "Taman Serom Perdana",
            "queryPlace": "Taman Serom Perdana, Sungai Mati, Johor"
          },
          {
            "name": "Taman Cemerlang",
            "queryPlace": "Taman Cemerlang, Sungai Mati, Johor"
          },
          {
            "name": "Taman Cempaka Serom",
            "queryPlace": "Taman Cempaka Serom, Sungai Mati, Johor"
          },
          {
            "name": "Taman Pulai Indah (Serom)",
            "queryPlace": "Taman Pulai Indah, Sungai Mati, Johor"
          },
          {
            "name": "Taman Sri Emas (Fasa 1 – 7)",
            "queryPlace": "Taman Sri Emas, Sungai Mati, Johor"
          },
          {
            "name": "Taman Muhibbah Jaya",
            "queryPlace": "Taman Muhibbah Jaya, Sungai Mati, Johor"
          },
          {
            "name": "Taman Muhibbah 3",
            "queryPlace": "Taman Muhibbah 3, Sungai Mati, Johor"
          },
          {
            "name": "Taman Kangkar Jaya",
            "queryPlace": "Taman Kangkar Jaya, Sungai Mati, Johor"
          },
          {
            "name": "Taman Bukit Kangkar Baru",
            "queryPlace": "Taman Bukit Kangkar Baru, Sungai Mati, Johor"
          },
          {
            "name": "Taman Melati (Sungai Mati)",
            "queryPlace": "Taman Melati, Sungai Mati, Johor"
          },
          {
            "name": "Taman Setia",
            "queryPlace": "Taman Setia, Sungai Mati, Johor"
          },
          {
            "name": "Taman Bestari",
            "queryPlace": "Taman Bestari, Sungai Mati, Johor"
          },
          {
            "name": "Taman Rawang Impian",
            "queryPlace": "Taman Rawang Impian, Sungai Mati, Johor"
          },
          {
            "name": "Taman Saujana Putra Serom",
            "queryPlace": "Taman Saujana Putra Serom, Sungai Mati, Johor"
          }
        ]
      },
      {
        "id": "johor_tangkak_tanjung_agas",
        "name": "Tanjung Agas",
        "fullName": "Tanjung Agas (Muar Border)",
        "queryPlace": "Tanjung Agas, Tangkak, Johor",
        "tamans": [
          {
            "name": "Taman Tangkak / Tanjung Agas",
            "queryPlace": "Taman Tangkak / Tanjung Agas, Tanjung Agas, Johor"
          },
          {
            "name": "Taman Sri Tanjung",
            "queryPlace": "Taman Sri Tanjung, Tanjung Agas, Johor"
          },
          {
            "name": "Taman Bakri Indah (Tanjung Agas)",
            "queryPlace": "Taman Bakri Indah, Tanjung Agas, Johor"
          },
          {
            "name": "Taman Melati Tanjung Agas",
            "queryPlace": "Taman Melati Tanjung Agas, Tanjung Agas, Johor"
          },
          {
            "name": "Taman Seri Maharani",
            "queryPlace": "Taman Seri Maharani, Tanjung Agas, Johor"
          },
          {
            "name": "Taman Dahlia",
            "queryPlace": "Taman Dahlia, Tanjung Agas, Johor"
          },
          {
            "name": "Taman Berkat",
            "queryPlace": "Taman Berkat, Tanjung Agas, Johor"
          },
          {
            "name": "Taman Wira",
            "queryPlace": "Taman Wira, Tanjung Agas, Johor"
          },
          {
            "name": "Kawasan Perindustrian Tanjung Agas",
            "queryPlace": "Kawasan Perindustrian Tanjung Agas, Tanjung Agas, Johor"
          }
        ]
      },
      {
        "id": "johor_tangkak_sagil",
        "name": "Sagil",
        "fullName": "Sagil",
        "queryPlace": "Sagil, Tangkak, Johor",
        "tamans": [
          {
            "name": "Taman Sagil Indah",
            "queryPlace": "Taman Sagil Indah, Sagil, Johor"
          },
          {
            "name": "Taman Desa Sagil",
            "queryPlace": "Taman Desa Sagil, Sagil, Johor"
          },
          {
            "name": "Pekan Sagil",
            "queryPlace": "Pekan Sagil, Sagil, Johor"
          }
        ]
      }
    ]
  },
  {
    "id": "johor_mersing",
    "num": 10,
    "name": "Mersing",
    "state": "Johor",
    "towns": [
      {
        "id": "johor_mersing_mersing",
        "name": "Mersing",
        "fullName": "Mersing Town (Mukim Mersing)",
        "queryPlace": "Mersing, Mersing, Johor",
        "tamans": [
          {
            "name": "Taman Mersing",
            "queryPlace": "Taman Mersing, Mersing, Johor"
          },
          {
            "name": "Taman Sri Mersing",
            "queryPlace": "Taman Sri Mersing, Mersing, Johor"
          },
          {
            "name": "Taman Nelayan",
            "queryPlace": "Taman Nelayan, Mersing, Johor"
          },
          {
            "name": "Taman Sri Pantai",
            "queryPlace": "Taman Sri Pantai, Mersing, Johor"
          },
          {
            "name": "Taman Tun Dr. Ismail",
            "queryPlace": "Taman Tun Dr. Ismail, Mersing, Johor"
          },
          {
            "name": "Taman Pantai Timur",
            "queryPlace": "Taman Pantai Timur, Mersing, Johor"
          },
          {
            "name": "Taman Guru",
            "queryPlace": "Taman Guru, Mersing, Johor"
          },
          {
            "name": "Taman Intan",
            "queryPlace": "Taman Intan, Mersing, Johor"
          },
          {
            "name": "Taman Pantai",
            "queryPlace": "Taman Pantai, Mersing, Johor"
          },
          {
            "name": "Taman Sri Bayu",
            "queryPlace": "Taman Sri Bayu, Mersing, Johor"
          },
          {
            "name": "Taman Seri Nakhoda & Taman Seri Nakhoda 1",
            "queryPlace": "Taman Seri Nakhoda & Taman Seri Nakhoda 1, Mersing, Johor"
          },
          {
            "name": "Taman Lautan Biru",
            "queryPlace": "Taman Lautan Biru, Mersing, Johor"
          },
          {
            "name": "Taman Wawasan",
            "queryPlace": "Taman Wawasan, Mersing, Johor"
          },
          {
            "name": "Taman Air Merah",
            "queryPlace": "Taman Air Merah, Mersing, Johor"
          },
          {
            "name": "Taman Emas",
            "queryPlace": "Taman Emas, Mersing, Johor"
          },
          {
            "name": "Taman Sri Daik",
            "queryPlace": "Taman Sri Daik, Mersing, Johor"
          },
          {
            "name": "Taman Samudera",
            "queryPlace": "Taman Samudera, Mersing, Johor"
          },
          {
            "name": "Taman Sutera Indah",
            "queryPlace": "Taman Sutera Indah, Mersing, Johor"
          },
          {
            "name": "Taman Mersing Kechil",
            "queryPlace": "Taman Mersing Kechil, Mersing, Johor"
          },
          {
            "name": "Taman Mahkota Mersing",
            "queryPlace": "Taman Mahkota Mersing, Mersing, Johor"
          }
        ]
      },
      {
        "id": "johor_mersing_endau",
        "name": "Endau",
        "fullName": "Endau (Mukim Endau)",
        "queryPlace": "Endau, Mersing, Johor",
        "tamans": [
          {
            "name": "Taman Desa Sri Endau",
            "queryPlace": "Taman Desa Sri Endau, Endau, Johor"
          },
          {
            "name": "Taman Bahagia",
            "queryPlace": "Taman Bahagia, Endau, Johor"
          },
          {
            "name": "Taman Mutiara",
            "queryPlace": "Taman Mutiara, Endau, Johor"
          },
          {
            "name": "Taman Haji Ariffin",
            "queryPlace": "Taman Haji Ariffin, Endau, Johor"
          },
          {
            "name": "Taman Fajar",
            "queryPlace": "Taman Fajar, Endau, Johor"
          },
          {
            "name": "Taman Markisa",
            "queryPlace": "Taman Markisa, Endau, Johor"
          },
          {
            "name": "Taman Endau Makmur",
            "queryPlace": "Taman Endau Makmur, Endau, Johor"
          },
          {
            "name": "Taman Roselle",
            "queryPlace": "Taman Roselle, Endau, Johor"
          },
          {
            "name": "Taman Koperasi Nelayan",
            "queryPlace": "Taman Koperasi Nelayan, Endau, Johor"
          },
          {
            "name": "Taman Harmoni (Endau)",
            "queryPlace": "Taman Harmoni, Endau, Johor"
          },
          {
            "name": "Taman Endau Utama",
            "queryPlace": "Taman Endau Utama, Endau, Johor"
          },
          {
            "name": "Taman Bahtera",
            "queryPlace": "Taman Bahtera, Endau, Johor"
          },
          {
            "name": "Taman Seri Endau",
            "queryPlace": "Taman Seri Endau, Endau, Johor"
          },
          {
            "name": "Pekan Padang Endau",
            "queryPlace": "Pekan Padang Endau, Endau, Johor"
          }
        ]
      },
      {
        "id": "johor_mersing_jemaluang",
        "name": "Jemaluang",
        "fullName": "Jemaluang",
        "queryPlace": "Jemaluang, Mersing, Johor",
        "tamans": [
          {
            "name": "Taman Jemaluang",
            "queryPlace": "Taman Jemaluang, Jemaluang, Johor"
          },
          {
            "name": "Taman Sri Jemaluang",
            "queryPlace": "Taman Sri Jemaluang, Jemaluang, Johor"
          },
          {
            "name": "Kampung Baru Jemaluang",
            "queryPlace": "Kampung Baru Jemaluang, Jemaluang, Johor"
          }
        ]
      },
      {
        "id": "johor_mersing_tenggaroh",
        "name": "Tenggaroh",
        "fullName": "Tenggaroh",
        "queryPlace": "Tenggaroh, Mersing, Johor",
        "tamans": [
          {
            "name": "Pekan Tenggaroh",
            "queryPlace": "Pekan Tenggaroh, Tenggaroh, Johor"
          },
          {
            "name": "FELDA Tenggaroh 1 – 7 Settlements",
            "queryPlace": "FELDA Tenggaroh 1 – 7 Settlements, Tenggaroh, Johor"
          }
        ]
      }
    ]
  }
]
};


export const SELANGOR_TERRITORY: StateTerritory = {
  "state": "Selangor",
  "districts": [
    {
      "id": "selangor_petaling",
      "num": 1,
      "name": "Petaling",
      "state": "Selangor",
      "towns": [
        {
          "id": "selangor_petaling_petaling_jaya_south",
          "name": "Petaling Jaya South",
          "fullName": "Petaling Jaya South & Old Town (MBPJ)",
          "queryPlace": "Petaling Jaya South, Petaling, Selangor",
          "tamans": [
            {
              "name": "Seksyen 1 & Seksyen 1A (Old Town Market / Inai / Pelandok)",
              "queryPlace": "Seksyen 1 & Seksyen 1A, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 2 (Jalan Othman Commercial Corridor)",
              "queryPlace": "Seksyen 2, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 3 (Jalan Assunta / Jalan Templer)",
              "queryPlace": "Seksyen 3, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 4 (Jalan Selangor / Jalan Penchala)",
              "queryPlace": "Seksyen 4, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 52 (PJ New Town Commercial Center / Menara MBPJ / Civic Centre)",
              "queryPlace": "Seksyen 52, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 9 (Jalan Gasing Hill / SMK La Salle corridor)",
              "queryPlace": "Seksyen 9, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 10",
              "queryPlace": "Seksyen 10, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 5 (Bukit Gasing / Bukit Veronica)",
              "queryPlace": "Seksyen 5, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 6",
              "queryPlace": "Seksyen 6, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 7",
              "queryPlace": "Seksyen 7, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 8",
              "queryPlace": "Seksyen 8, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 11",
              "queryPlace": "Seksyen 11, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 12",
              "queryPlace": "Seksyen 12, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 13 (Commercial, Healthcare & University Corridor)",
              "queryPlace": "Seksyen 13, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 14 (Jalan Semangat / Digital Mall)",
              "queryPlace": "Seksyen 14, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 18",
              "queryPlace": "Seksyen 18, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 20 (Taman Paramount)",
              "queryPlace": "Seksyen 20, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 21 (Sea Park)",
              "queryPlace": "Seksyen 21, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 22",
              "queryPlace": "Seksyen 22, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 51",
              "queryPlace": "Seksyen 51, Petaling Jaya South, Selangor"
            },
            {
              "name": "Seksyen 51A (Cycle & Carriage / Federal Highway Industrial Enclave)",
              "queryPlace": "Seksyen 51A, Petaling Jaya South, Selangor"
            },
            {
              "name": "PJS 1 (Taman Petaling Utama)",
              "queryPlace": "PJS 1, Petaling Jaya South, Selangor"
            },
            {
              "name": "PJS 2 (Kampung Medan / Taman Dato' Harun)",
              "queryPlace": "PJS 2, Petaling Jaya South, Selangor"
            },
            {
              "name": "PJS 3 (Taman Medan / Taman Sri Manja / Taman Sri Sentosa border)",
              "queryPlace": "PJS 3, Petaling Jaya South, Selangor"
            },
            {
              "name": "PJS 4 (Taman Medan Harun)",
              "queryPlace": "PJS 4, Petaling Jaya South, Selangor"
            },
            {
              "name": "PJS 5 (Taman Desaria)",
              "queryPlace": "PJS 5, Petaling Jaya South, Selangor"
            },
            {
              "name": "PJS 6 (Kampung Lindungan)",
              "queryPlace": "PJS 6, Petaling Jaya South, Selangor"
            },
            {
              "name": "Taman Maju Jaya",
              "queryPlace": "Taman Maju Jaya, Petaling Jaya South, Selangor"
            }
          ]
        },
        {
          "id": "selangor_petaling_petaling_jaya_central",
          "name": "Petaling Jaya Central",
          "fullName": "Petaling Jaya Central & \"SS\" Precincts (MBPJ)",
          "queryPlace": "Petaling Jaya Central, Petaling, Selangor",
          "tamans": [
            {
              "name": "SS1 (Kampung Tunku)",
              "queryPlace": "SS1, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS2 (Central Commercial Triangle & Chow Yang)",
              "queryPlace": "SS2, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS3 (Taman Universiti)",
              "queryPlace": "SS3, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS4 (Kelana Jaya East)",
              "queryPlace": "SS4, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS5 (Kelana Jaya Central)",
              "queryPlace": "SS5, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS6 (Kelana Jaya Commercial Centre / Glomac Business Centre)",
              "queryPlace": "SS6, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS7 (Kelana Jaya West / Paradigm Mall / Kelana Centre Point / MBPJ Stadium)",
              "queryPlace": "SS7, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS8 (Sungai Way Free Trade Industrial Zone - FTZ)",
              "queryPlace": "SS8, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS9 (Sungai Way New Village)",
              "queryPlace": "SS9, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS9A (Seri Setia)",
              "queryPlace": "SS9A, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS10",
              "queryPlace": "SS10, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS20 (Damansara Kim)",
              "queryPlace": "SS20, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS21 (Damansara Utama / Uptown Commercial Hub)",
              "queryPlace": "SS21, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS22 & SS22A (Damansara Jaya / Atria Shopping Gallery)",
              "queryPlace": "SS22 & SS22A, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS23 (Taman SEA)",
              "queryPlace": "SS23, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS24 (Taman Megah)",
              "queryPlace": "SS24, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS25 (Taman Mayang)",
              "queryPlace": "SS25, Petaling Jaya Central, Selangor"
            },
            {
              "name": "SS26 (Taman Mayang Jaya)",
              "queryPlace": "SS26, Petaling Jaya Central, Selangor"
            }
          ]
        },
        {
          "id": "selangor_petaling_damansara",
          "name": "Damansara",
          "fullName": "Petaling Jaya North / Damansara Corridor (MBPJ)",
          "queryPlace": "Damansara, Petaling, Selangor",
          "tamans": [
            {
              "name": "Bandar Utama (PJU 6)",
              "queryPlace": "Bandar Utama, Damansara, Selangor"
            },
            {
              "name": "Bandar Utama 1 (BU 1) to Bandar Utama 12 (BU 12)",
              "queryPlace": "Bandar Utama 1 to Bandar Utama 12, Damansara, Selangor"
            },
            {
              "name": "Effingham",
              "queryPlace": "Effingham, Damansara, Selangor"
            },
            {
              "name": "Centrepoint Commercial Zone & 1 Utama Environs",
              "queryPlace": "Centrepoint Commercial Zone & 1 Utama Environs, Damansara, Selangor"
            },
            {
              "name": "Kampung Sungai Kayu Ara (Kayu Ara)",
              "queryPlace": "Kampung Sungai Kayu Ara, Damansara, Selangor"
            },
            {
              "name": "Kayu Ara Business Park",
              "queryPlace": "Kayu Ara Business Park, Damansara, Selangor"
            },
            {
              "name": "Damansara Sutera & SeTerra",
              "queryPlace": "Damansara Sutera & SeTerra, Damansara, Selangor"
            },
            {
              "name": "Mutiara Damansara (PJU 7)",
              "queryPlace": "Mutiara Damansara, Damansara, Selangor"
            },
            {
              "name": "Mutiara Homes",
              "queryPlace": "Mutiara Homes, Damansara, Selangor"
            },
            {
              "name": "Mutiara Damansara Bungalows & Semi-Ds",
              "queryPlace": "Mutiara Damansara Bungalows & Semi-Ds, Damansara, Selangor"
            },
            {
              "name": "The Curve / IPC / IKEA / eCurve Commercial Hub",
              "queryPlace": "The Curve / IPC / IKEA / eCurve Commercial Hub, Damansara, Selangor"
            },
            {
              "name": "Damansara Perdana (PJU 8)",
              "queryPlace": "Damansara Perdana, Damansara, Selangor"
            },
            {
              "name": "Empire Damansara & Empire City",
              "queryPlace": "Empire Damansara & Empire City, Damansara, Selangor"
            },
            {
              "name": "Armanee Terrace 1 & 2",
              "queryPlace": "Armanee Terrace 1 & 2, Damansara, Selangor"
            },
            {
              "name": "Perdana Exclusive & Emerald Condominium",
              "queryPlace": "Perdana Exclusive & Emerald Condominium, Damansara, Selangor"
            },
            {
              "name": "Flora Damansara",
              "queryPlace": "Flora Damansara, Damansara, Selangor"
            },
            {
              "name": "Rafflesia Damansara Perdana",
              "queryPlace": "Rafflesia Damansara Perdana, Damansara, Selangor"
            },
            {
              "name": "Kota Damansara (PJU 5)",
              "queryPlace": "Kota Damansara, Damansara, Selangor"
            },
            {
              "name": "Seksyen 4 (D'Villa, Sierra Damansara)",
              "queryPlace": "Seksyen 4, Damansara, Selangor"
            },
            {
              "name": "Seksyen 5",
              "queryPlace": "Seksyen 5, Damansara, Selangor"
            },
            {
              "name": "Seksyen 6",
              "queryPlace": "Seksyen 6, Damansara, Selangor"
            },
            {
              "name": "Seksyen 7",
              "queryPlace": "Seksyen 7, Damansara, Selangor"
            },
            {
              "name": "Seksyen 8",
              "queryPlace": "Seksyen 8, Damansara, Selangor"
            },
            {
              "name": "Seksyen 9 (Subang Damansara)",
              "queryPlace": "Seksyen 9, Damansara, Selangor"
            },
            {
              "name": "Seksyen 10 (De Kota)",
              "queryPlace": "Seksyen 10, Damansara, Selangor"
            },
            {
              "name": "Seksyen 11 (Bayu Damansara, Bayu Segar)",
              "queryPlace": "Seksyen 11, Damansara, Selangor"
            },
            {
              "name": "The Strand & Sunway Nexis Commercial Precinct",
              "queryPlace": "The Strand & Sunway Nexis Commercial Precinct, Damansara, Selangor"
            },
            {
              "name": "Kota Damansara Community Forest Reserve Corridor",
              "queryPlace": "Kota Damansara Community Forest Reserve Corridor, Damansara, Selangor"
            },
            {
              "name": "Ara Damansara (PJU 1A)",
              "queryPlace": "Ara Damansara, Damansara, Selangor"
            },
            {
              "name": "Damansara Idaman",
              "queryPlace": "Damansara Idaman, Damansara, Selangor"
            },
            {
              "name": "Damansara Legenda",
              "queryPlace": "Damansara Legenda, Damansara, Selangor"
            },
            {
              "name": "Seri Pilmoor",
              "queryPlace": "Seri Pilmoor, Damansara, Selangor"
            },
            {
              "name": "Ara Vista",
              "queryPlace": "Ara Vista, Damansara, Selangor"
            },
            {
              "name": "Ara Hill",
              "queryPlace": "Ara Hill, Damansara, Selangor"
            },
            {
              "name": "Winchester",
              "queryPlace": "Winchester, Damansara, Selangor"
            },
            {
              "name": "Oasis Damansara / Oasis Square",
              "queryPlace": "Oasis Damansara / Oasis Square, Damansara, Selangor"
            },
            {
              "name": "Tropicana & Sunway Damansara (PJU 3)",
              "queryPlace": "Tropicana & Sunway Damansara, Damansara, Selangor"
            },
            {
              "name": "Tropicana Golf & Country Resort",
              "queryPlace": "Tropicana Golf & Country Resort, Damansara, Selangor"
            },
            {
              "name": "Tropicana Indah Resort Homes",
              "queryPlace": "Tropicana Indah Resort Homes, Damansara, Selangor"
            },
            {
              "name": "Taman Bukit Mayang Emas",
              "queryPlace": "Taman Bukit Mayang Emas, Damansara, Selangor"
            },
            {
              "name": "Sunway Damansara (Sunway Sutera, Sunway Rymba Hills, Parkville)",
              "queryPlace": "Sunway Damansara, Damansara, Selangor"
            },
            {
              "name": "Bandar Sri Damansara (PJU 9)",
              "queryPlace": "Bandar Sri Damansara, Damansara, Selangor"
            },
            {
              "name": "SD 1 to SD 15",
              "queryPlace": "SD 1 to SD 15, Damansara, Selangor"
            },
            {
              "name": "Damansara Foresta",
              "queryPlace": "Damansara Foresta, Damansara, Selangor"
            },
            {
              "name": "Ativo Suites / Damansara Avenue",
              "queryPlace": "Ativo Suites / Damansara Avenue, Damansara, Selangor"
            },
            {
              "name": "Damansara Damai (PJU 10)",
              "queryPlace": "Damansara Damai, Damansara, Selangor"
            },
            {
              "name": "Saujana Apartment",
              "queryPlace": "Saujana Apartment, Damansara, Selangor"
            },
            {
              "name": "Armanee Condominium",
              "queryPlace": "Armanee Condominium, Damansara, Selangor"
            },
            {
              "name": "Bayu Perdana",
              "queryPlace": "Bayu Perdana, Damansara, Selangor"
            },
            {
              "name": "Impian Apartment",
              "queryPlace": "Impian Apartment, Damansara, Selangor"
            },
            {
              "name": "One Damansara",
              "queryPlace": "One Damansara, Damansara, Selangor"
            },
            {
              "name": "Dataran Prima & Aman Suria (PJU 1)",
              "queryPlace": "Dataran Prima & Aman Suria, Damansara, Selangor"
            },
            {
              "name": "Aman Suria Damansara",
              "queryPlace": "Aman Suria Damansara, Damansara, Selangor"
            },
            {
              "name": "Dataran Prima",
              "queryPlace": "Dataran Prima, Damansara, Selangor"
            },
            {
              "name": "Sunway Mas Commercial Centre",
              "queryPlace": "Sunway Mas Commercial Centre, Damansara, Selangor"
            }
          ]
        },
        {
          "id": "selangor_petaling_subang_jaya",
          "name": "Subang Jaya",
          "fullName": "Subang Jaya Core & Bandar Sunway (MBSJ)",
          "queryPlace": "Subang Jaya, Petaling, Selangor",
          "tamans": [
            {
              "name": "SS12 (Subang Jaya Medical Centre / Grand Dorsett Zone)",
              "queryPlace": "SS12, Subang Jaya, Selangor"
            },
            {
              "name": "SS13 (Subang Industrial Estate)",
              "queryPlace": "SS13, Subang Jaya, Selangor"
            },
            {
              "name": "SS14 (Commercial & Residential Corridor)",
              "queryPlace": "SS14, Subang Jaya, Selangor"
            },
            {
              "name": "SS15 (Education & F&B Hub / INTI International University)",
              "queryPlace": "SS15, Subang Jaya, Selangor"
            },
            {
              "name": "SS16 (Empire Shopping Gallery / Subang Parade Corridor)",
              "queryPlace": "SS16, Subang Jaya, Selangor"
            },
            {
              "name": "SS17",
              "queryPlace": "SS17, Subang Jaya, Selangor"
            },
            {
              "name": "SS18",
              "queryPlace": "SS18, Subang Jaya, Selangor"
            },
            {
              "name": "SS19",
              "queryPlace": "SS19, Subang Jaya, Selangor"
            },
            {
              "name": "Bandar Sunway",
              "queryPlace": "Bandar Sunway, Subang Jaya, Selangor"
            },
            {
              "name": "PJS 7 (Sunway South Quay / BayRocks)",
              "queryPlace": "PJS 7, Subang Jaya, Selangor"
            },
            {
              "name": "PJS 8 (Sunway Mentari / Mentari Court / Sunway Mentari Business Park)",
              "queryPlace": "PJS 8, Subang Jaya, Selangor"
            },
            {
              "name": "PJS 9 (Sunway Medical Centre / Sunway Geo)",
              "queryPlace": "PJS 9, Subang Jaya, Selangor"
            },
            {
              "name": "PJS 10",
              "queryPlace": "PJS 10, Subang Jaya, Selangor"
            },
            {
              "name": "PJS 11 (Sunway Pyramid / Sunway Lagoon / Monash & Sunway University)",
              "queryPlace": "PJS 11, Subang Jaya, Selangor"
            }
          ]
        },
        {
          "id": "selangor_petaling_usj_putra_heights",
          "name": "USJ & Putra Heights",
          "fullName": "UEP Subang Jaya (USJ) & Putra Heights (MBSJ)",
          "queryPlace": "USJ & Putra Heights, Petaling, Selangor",
          "tamans": [
            {
              "name": "USJ 1 (Subang Perdana, Goodyear Court 1 & 2, The Summit, Da Men)",
              "queryPlace": "USJ 1, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 2",
              "queryPlace": "USJ 2, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 3, USJ 3A, USJ 3B, USJ 3C, USJ 3D",
              "queryPlace": "USJ 3, USJ 3A, USJ 3B, USJ 3C, USJ 3D, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 4",
              "queryPlace": "USJ 4, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 5",
              "queryPlace": "USJ 5, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 6 (Taipan Business Centre Border)",
              "queryPlace": "USJ 6, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 7 & USJ 8 (Goodyear Court 3, 4, 5)",
              "queryPlace": "USJ 7 & USJ 8, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 9 & USJ 10 (Taipan Commercial Triangle)",
              "queryPlace": "USJ 9 & USJ 10, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 11",
              "queryPlace": "USJ 11, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 12",
              "queryPlace": "USJ 12, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 13",
              "queryPlace": "USJ 13, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 14 (Goodyear Court 6, 7, 8, 9, 10)",
              "queryPlace": "USJ 14, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 15",
              "queryPlace": "USJ 15, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 16",
              "queryPlace": "USJ 16, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 17",
              "queryPlace": "USJ 17, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 18",
              "queryPlace": "USJ 18, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 19 (The USJ 19 City Mall corridor)",
              "queryPlace": "USJ 19, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 20",
              "queryPlace": "USJ 20, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 21 (Main Place Mall)",
              "queryPlace": "USJ 21, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 22",
              "queryPlace": "USJ 22, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ 23 to USJ 27",
              "queryPlace": "USJ 23 to USJ 27, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ Heights & Subang Heights",
              "queryPlace": "USJ Heights & Subang Heights, USJ & Putra Heights, Selangor"
            },
            {
              "name": "USJ Heights (Sakura, Reika, Kayangan, Mandara, Capri, Cyprus, Indigo)",
              "queryPlace": "USJ Heights, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Subang Heights (East & West Parcels)",
              "queryPlace": "Subang Heights, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Putra Heights",
              "queryPlace": "Putra Heights, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Seksyen 1 to Seksyen 10",
              "queryPlace": "Seksyen 1 to Seksyen 10, USJ & Putra Heights, Selangor"
            },
            {
              "name": "The Glades (The Mews, Ensemble, Verse)",
              "queryPlace": "The Glades, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Putra Palms",
              "queryPlace": "Putra Palms, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Kingsley Hills",
              "queryPlace": "Kingsley Hills, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Putra Crest",
              "queryPlace": "Putra Crest, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Putra Avenue",
              "queryPlace": "Putra Avenue, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Laman Putra",
              "queryPlace": "Laman Putra, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Putra Point Commercial Hub",
              "queryPlace": "Putra Point Commercial Hub, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Batu Tiga Subang",
              "queryPlace": "Batu Tiga Subang, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Taman Mutiara Subang",
              "queryPlace": "Taman Mutiara Subang, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Tropicana Metropark (Pandora, Paloma, Paisley)",
              "queryPlace": "Tropicana Metropark, USJ & Putra Heights, Selangor"
            },
            {
              "name": "Subang Hi-Tech Industrial Park",
              "queryPlace": "Subang Hi-Tech Industrial Park, USJ & Putra Heights, Selangor"
            }
          ]
        },
        {
          "id": "selangor_petaling_puchong",
          "name": "Puchong",
          "fullName": "Puchong Core & Suburbs (MBSJ)",
          "queryPlace": "Puchong, Petaling, Selangor",
          "tamans": [
            {
              "name": "Bandar Puchong Jaya",
              "queryPlace": "Bandar Puchong Jaya, Puchong, Selangor"
            },
            {
              "name": "Jalan Kenari Commercial Hub (IOI Boulevard)",
              "queryPlace": "Jalan Kenari Commercial Hub, Puchong, Selangor"
            },
            {
              "name": "Jalan Pipit Zone",
              "queryPlace": "Jalan Pipit Zone, Puchong, Selangor"
            },
            {
              "name": "Jalan Tempua Zone",
              "queryPlace": "Jalan Tempua Zone, Puchong, Selangor"
            },
            {
              "name": "Jalan Rajawali Zone",
              "queryPlace": "Jalan Rajawali Zone, Puchong, Selangor"
            },
            {
              "name": "Jalan Merpati Zone",
              "queryPlace": "Jalan Merpati Zone, Puchong, Selangor"
            },
            {
              "name": "Skypod Residences & Twin Residences",
              "queryPlace": "Skypod Residences & Twin Residences, Puchong, Selangor"
            },
            {
              "name": "Pusat Bandar Puchong (PBP)",
              "queryPlace": "Pusat Bandar Puchong, Puchong, Selangor"
            },
            {
              "name": "Taman Wawasan (Wawasan 1, 2, 3, 4)",
              "queryPlace": "Taman Wawasan, Puchong, Selangor"
            },
            {
              "name": "Taman Industri Pusat Bandar Puchong",
              "queryPlace": "Taman Industri Pusat Bandar Puchong, Puchong, Selangor"
            },
            {
              "name": "SetiaWalk Puchong",
              "queryPlace": "SetiaWalk Puchong, Puchong, Selangor"
            },
            {
              "name": "Bandar Puteri Puchong",
              "queryPlace": "Bandar Puteri Puchong, Puchong, Selangor"
            },
            {
              "name": "Presint 1 to Presint 12",
              "queryPlace": "Presint 1 to Presint 12, Puchong, Selangor"
            },
            {
              "name": "The Hill & Puteri Hills",
              "queryPlace": "The Hill & Puteri Hills, Puchong, Selangor"
            },
            {
              "name": "Bayan, Sri Dahlia, Sri Cassia, Sri Camellia",
              "queryPlace": "Bayan, Sri Dahlia, Sri Cassia, Sri Camellia, Puchong, Selangor"
            },
            {
              "name": "The Cube Commercial",
              "queryPlace": "The Cube Commercial, Puchong, Selangor"
            },
            {
              "name": "Puteri Mart Precinct",
              "queryPlace": "Puteri Mart Precinct, Puchong, Selangor"
            },
            {
              "name": "Bandar Kinrara",
              "queryPlace": "Bandar Kinrara, Puchong, Selangor"
            },
            {
              "name": "Bandar Kinrara 1 (BK 1) to Bandar Kinrara 9 (BK 9)",
              "queryPlace": "Bandar Kinrara 1 to Bandar Kinrara 9, Puchong, Selangor"
            },
            {
              "name": "Kinrara Hills",
              "queryPlace": "Kinrara Hills, Puchong, Selangor"
            },
            {
              "name": "Simfoni Kinrara",
              "queryPlace": "Simfoni Kinrara, Puchong, Selangor"
            },
            {
              "name": "Qaseh & Sierra Residences",
              "queryPlace": "Qaseh & Sierra Residences, Puchong, Selangor"
            },
            {
              "name": "Duet Residence",
              "queryPlace": "Duet Residence, Puchong, Selangor"
            },
            {
              "name": "Kinrara Golf Club Zone",
              "queryPlace": "Kinrara Golf Club Zone, Puchong, Selangor"
            },
            {
              "name": "Taman Kinrara",
              "queryPlace": "Taman Kinrara, Puchong, Selangor"
            },
            {
              "name": "Taman Kinrara Seksyen 1 to Seksyen 5 (TK 1 – TK 5)",
              "queryPlace": "Taman Kinrara Seksyen 1 to Seksyen 5, Puchong, Selangor"
            },
            {
              "name": "Vista Lavender",
              "queryPlace": "Vista Lavender, Puchong, Selangor"
            },
            {
              "name": "Puchong Perdana & Puchong Prima",
              "queryPlace": "Puchong Perdana & Puchong Prima, Puchong, Selangor"
            },
            {
              "name": "Taman Puchong Perdana",
              "queryPlace": "Taman Puchong Perdana, Puchong, Selangor"
            },
            {
              "name": "Taman Puchong Indah",
              "queryPlace": "Taman Puchong Indah, Puchong, Selangor"
            },
            {
              "name": "Taman Puchong Intan",
              "queryPlace": "Taman Puchong Intan, Puchong, Selangor"
            },
            {
              "name": "Taman Puchong Prima",
              "queryPlace": "Taman Puchong Prima, Puchong, Selangor"
            },
            {
              "name": "Desa Idaman",
              "queryPlace": "Desa Idaman, Puchong, Selangor"
            },
            {
              "name": "Desa Impiana",
              "queryPlace": "Desa Impiana, Puchong, Selangor"
            },
            {
              "name": "Taman Puchong Permai",
              "queryPlace": "Taman Puchong Permai, Puchong, Selangor"
            },
            {
              "name": "Puchong Utama & Bukit Puchong",
              "queryPlace": "Puchong Utama & Bukit Puchong, Puchong, Selangor"
            },
            {
              "name": "Taman Puchong Utama (PU 1 to PU 12)",
              "queryPlace": "Taman Puchong Utama, Puchong, Selangor"
            },
            {
              "name": "Bandar Bukit Puchong (Bukit Puchong 1 & Bukit Puchong 2)",
              "queryPlace": "Bandar Bukit Puchong, Puchong, Selangor"
            },
            {
              "name": "Epic Residence",
              "queryPlace": "Epic Residence, Puchong, Selangor"
            },
            {
              "name": "Ametis Terraces",
              "queryPlace": "Ametis Terraces, Puchong, Selangor"
            },
            {
              "name": "Baiduri Courts",
              "queryPlace": "Baiduri Courts, Puchong, Selangor"
            },
            {
              "name": "Nilam Terraces",
              "queryPlace": "Nilam Terraces, Puchong, Selangor"
            },
            {
              "name": "Taman Tasik Prima (Lakeita, Summer Homes, Wharf Residences)",
              "queryPlace": "Taman Tasik Prima, Puchong, Selangor"
            },
            {
              "name": "Taman Meranti Jaya (Tanming Boulevard)",
              "queryPlace": "Taman Meranti Jaya, Puchong, Selangor"
            },
            {
              "name": "Taman Putra Prima (Fasa 1 – 8A)",
              "queryPlace": "Taman Putra Prima, Puchong, Selangor"
            },
            {
              "name": "Taman Saujana Puchong (SP 1 – SP 10)",
              "queryPlace": "Taman Saujana Puchong, Puchong, Selangor"
            },
            {
              "name": "D'Island Residence (Nautilus, Corallia, Balivia, Skyvilla)",
              "queryPlace": "D'Island Residence, Puchong, Selangor"
            },
            {
              "name": "Taman Mas Puchong (Koi Tropika, Koi Boulevard, Elite 33)",
              "queryPlace": "Taman Mas Puchong, Puchong, Selangor"
            },
            {
              "name": "Taman Puchong Hartamas",
              "queryPlace": "Taman Puchong Hartamas, Puchong, Selangor"
            },
            {
              "name": "Taman Mutiara Puchong",
              "queryPlace": "Taman Mutiara Puchong, Puchong, Selangor"
            },
            {
              "name": "Taman Puchong Tekali",
              "queryPlace": "Taman Puchong Tekali, Puchong, Selangor"
            },
            {
              "name": "Pulau Meranti & Kampung Kuala Sungai Baru",
              "queryPlace": "Pulau Meranti & Kampung Kuala Sungai Baru, Puchong, Selangor"
            },
            {
              "name": "Kampung Baru Puchong (Batu 14 Puchong)",
              "queryPlace": "Kampung Baru Puchong, Puchong, Selangor"
            }
          ]
        },
        {
          "id": "selangor_petaling_seri_kembangan_serdang",
          "name": "Seri Kembangan & Serdang",
          "fullName": "Seri Kembangan & Serdang (MBSJ)",
          "queryPlace": "Seri Kembangan & Serdang, Petaling, Selangor",
          "tamans": [
            {
              "name": "Kampung Baru Seri Kembangan",
              "queryPlace": "Kampung Baru Seri Kembangan, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Pasar Besar Seri Kembangan Corridor",
              "queryPlace": "Pasar Besar Seri Kembangan Corridor, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Taman Serdang Perdana (Cheong Hin Commercial City)",
              "queryPlace": "Taman Serdang Perdana, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "One South (Flora, Gardenz, Parkz)",
              "queryPlace": "One South, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "The Mines Resort City",
              "queryPlace": "The Mines Resort City, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Bluwater Estate (Blu Constellation, The Heritage)",
              "queryPlace": "Bluwater Estate, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Serdang Raya Seksyen 1 to Seksyen 8",
              "queryPlace": "Serdang Raya Seksyen 1 to Seksyen 8, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Seksyen 1 to Seksyen 14",
              "queryPlace": "Seksyen 1 to Seksyen 14, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Aman Heights",
              "queryPlace": "Aman Heights, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "The Park @ Bukit Serdang",
              "queryPlace": "The Park @ Bukit Serdang, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Taman Universiti Indah",
              "queryPlace": "Taman Universiti Indah, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Taman Pinggiran Putra",
              "queryPlace": "Taman Pinggiran Putra, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Taman Equine (Equine Park, Villa Heights, Crescentia Park)",
              "queryPlace": "Taman Equine, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Pusat Bandar Putra Permai",
              "queryPlace": "Pusat Bandar Putra Permai, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Taman Lestari Perdana (LP 1 to LP 8)",
              "queryPlace": "Taman Lestari Perdana, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Lestari Puchong",
              "queryPlace": "Lestari Puchong, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Taman Desaminium (Desaminium Flora, Desaminium Rimba)",
              "queryPlace": "Taman Desaminium, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Taman Puncak Jalil (PUJ 1 to PUJ 9)",
              "queryPlace": "Taman Puncak Jalil, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Taman Sri Serdang",
              "queryPlace": "Taman Sri Serdang, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Taman Serdang Jaya",
              "queryPlace": "Taman Serdang Jaya, Seri Kembangan & Serdang, Selangor"
            },
            {
              "name": "Kawasan Perindustrian Serdang Lama",
              "queryPlace": "Kawasan Perindustrian Serdang Lama, Seri Kembangan & Serdang, Selangor"
            }
          ]
        },
        {
          "id": "selangor_petaling_shah_alam",
          "name": "Shah Alam",
          "fullName": "Shah Alam (Central, East & North - MBSA / Petaling District)",
          "queryPlace": "Shah Alam, Petaling, Selangor",
          "tamans": [
            {
              "name": "Seksyen 1 (UiTM Main Campus)",
              "queryPlace": "Seksyen 1, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 2 (Taman Tasik Shah Alam, Wet World)",
              "queryPlace": "Seksyen 2, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 3",
              "queryPlace": "Seksyen 3, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 4",
              "queryPlace": "Seksyen 4, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 5",
              "queryPlace": "Seksyen 5, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 6",
              "queryPlace": "Seksyen 6, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 7 (i-City, Kristal Heights, Nilam Sari)",
              "queryPlace": "Seksyen 7, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 8",
              "queryPlace": "Seksyen 8, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 9 (Plaza Shah Alam)",
              "queryPlace": "Seksyen 9, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 10",
              "queryPlace": "Seksyen 10, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 11",
              "queryPlace": "Seksyen 11, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 12 (Istana Bukit Kayangan)",
              "queryPlace": "Seksyen 12, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 13 (Shah Alam Stadium, Tadisma Business Park, Metia, Menara U)",
              "queryPlace": "Seksyen 13, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 14 (Pusat Bandar Shah Alam / Dataran MBSA)",
              "queryPlace": "Seksyen 14, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 15 (Dataran Otomobil)",
              "queryPlace": "Seksyen 15, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 16",
              "queryPlace": "Seksyen 16, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 17",
              "queryPlace": "Seksyen 17, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 18",
              "queryPlace": "Seksyen 18, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 19",
              "queryPlace": "Seksyen 19, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 20 (Hospital KPJ Selangor)",
              "queryPlace": "Seksyen 20, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 21",
              "queryPlace": "Seksyen 21, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 22 (Alam Sanjung, Subang Andaman)",
              "queryPlace": "Seksyen 22, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 23",
              "queryPlace": "Seksyen 23, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 24",
              "queryPlace": "Seksyen 24, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 25 (Taman Sri Muda)",
              "queryPlace": "Seksyen 25, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 26 (HICOM Industrial Estate)",
              "queryPlace": "Seksyen 26, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 27 (Taman Bunga Negara)",
              "queryPlace": "Seksyen 27, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 28 (Taman Alam Megah)",
              "queryPlace": "Seksyen 28, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 31 (Kota Kemuning: Hill Ville, Sri Suria, Lagoon Homes, Onsen, Canal City)",
              "queryPlace": "Seksyen 31, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 32 (Bukit Rimau, Bukit Naga)",
              "queryPlace": "Seksyen 32, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 33 (Taman Bukit Kemuning)",
              "queryPlace": "Seksyen 33, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen 35 (Alam Impian: Canting, Pentas, Spira, Sephira)",
              "queryPlace": "Seksyen 35, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U1 (Glenmarie, Temasya Glenmarie, TTDI Jaya)",
              "queryPlace": "Seksyen U1, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U2 (Saujana, Glenmarie Court, Saujana O-Lot, Glenpark)",
              "queryPlace": "Seksyen U2, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U3 (Taman Subang Perdana)",
              "queryPlace": "Seksyen U3, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U4 (Sultan Abdul Aziz Shah Airport / LTSAAS Subang)",
              "queryPlace": "Seksyen U4, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U5 (Bandar Pinggiran Subang, Subang Bestari, Mah Sing)",
              "queryPlace": "Seksyen U5, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U6 (Kampung Melayu Subang / Pekan Subang)",
              "queryPlace": "Seksyen U6, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U8 (Bukit Jelutong: Jelutong Heights, Radia, D'Pangkin)",
              "queryPlace": "Seksyen U8, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U9 (Sunway Kayangan, Kayangan Heights, Cahaya SPK)",
              "queryPlace": "Seksyen U9, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U10 (Alam Budiman, Greenhill Residence, Nusa Rhu, Sunway Alam Suria)",
              "queryPlace": "Seksyen U10, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U11 (Bukit Bandaraya Shah Alam)",
              "queryPlace": "Seksyen U11, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U12 (Cahaya Alam, Suria Hill)",
              "queryPlace": "Seksyen U12, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U13 (Setia Alam: Setia Damai, Setia Impian, Setia Indah, Setia Eco Park, Eco Ardence)",
              "queryPlace": "Seksyen U13, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U16 (Denai Alam, Bukit Subang)",
              "queryPlace": "Seksyen U16, Shah Alam, Selangor"
            },
            {
              "name": "Seksyen U17 (City of Elmina: Elmina Valley, Elmina Green, Elmina West)",
              "queryPlace": "Seksyen U17, Shah Alam, Selangor"
            }
          ]
        }
      ]
    },
    {
      "id": "selangor_klang",
      "num": 2,
      "name": "Klang",
      "state": "Selangor",
      "towns": [
        {
          "id": "selangor_klang_klang_town",
          "name": "Klang Town",
          "fullName": "Klang Town Core & Southern Urban Environs (MBDK)",
          "queryPlace": "Klang Town, Klang, Selangor",
          "tamans": [
            {
              "name": "Jalan Tengku Kelana (Little India)",
              "queryPlace": "Jalan Tengku Kelana, Klang Town, Selangor"
            },
            {
              "name": "Jalan Kapar / Jalan Meru Junctions",
              "queryPlace": "Jalan Kapar / Jalan Meru Junctions, Klang Town, Selangor"
            },
            {
              "name": "Kawasan Istana Alam Shah (Bukit Kota)",
              "queryPlace": "Kawasan Istana Alam Shah, Klang Town, Selangor"
            },
            {
              "name": "Taman Bandar Diraja Klang",
              "queryPlace": "Taman Bandar Diraja Klang, Klang Town, Selangor"
            },
            {
              "name": "Taman Melawis",
              "queryPlace": "Taman Melawis, Klang Town, Selangor"
            },
            {
              "name": "Taman Chi Liung",
              "queryPlace": "Taman Chi Liung, Klang Town, Selangor"
            },
            {
              "name": "Taman Southern Park (Taman Selatan)",
              "queryPlace": "Taman Southern Park, Klang Town, Selangor"
            },
            {
              "name": "Taman Palm Grove",
              "queryPlace": "Taman Palm Grove, Klang Town, Selangor"
            },
            {
              "name": "Taman Bayu Perdana",
              "queryPlace": "Taman Bayu Perdana, Klang Town, Selangor"
            },
            {
              "name": "Taman Telok Pulai",
              "queryPlace": "Taman Telok Pulai, Klang Town, Selangor"
            },
            {
              "name": "Taman Telok Gadong (Gadong Indah, Gadong Besar)",
              "queryPlace": "Taman Telok Gadong, Klang Town, Selangor"
            },
            {
              "name": "Taman Radzi",
              "queryPlace": "Taman Radzi, Klang Town, Selangor"
            },
            {
              "name": "Taman Gembira (Klang)",
              "queryPlace": "Taman Gembira, Klang Town, Selangor"
            },
            {
              "name": "Taman Petani",
              "queryPlace": "Taman Petani, Klang Town, Selangor"
            },
            {
              "name": "Taman Sri Gadong",
              "queryPlace": "Taman Sri Gadong, Klang Town, Selangor"
            },
            {
              "name": "Taman Raja Uda",
              "queryPlace": "Taman Raja Uda, Klang Town, Selangor"
            },
            {
              "name": "Taman Melati (Klang Selatan)",
              "queryPlace": "Taman Melati, Klang Town, Selangor"
            }
          ]
        },
        {
          "id": "selangor_klang_bukit_tinggi_botanic",
          "name": "Bukit Tinggi & Botanic",
          "fullName": "Bandar Bukit Tinggi, Bandar Botanic & South Klang Growth Corridor (MBDK)",
          "queryPlace": "Bukit Tinggi & Botanic, Klang, Selangor",
          "tamans": [
            {
              "name": "Bandar Bukit Tinggi",
              "queryPlace": "Bandar Bukit Tinggi, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Bandar Bukit Tinggi 1 (BBT 1: Batu Nilam commercial zone, Butterfly Park)",
              "queryPlace": "Bandar Bukit Tinggi 1, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Bandar Bukit Tinggi 2 (BBT 2: Bukit Tinggi Avenue, AEON Mall corridor)",
              "queryPlace": "Bandar Bukit Tinggi 2, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Bandar Bukit Tinggi 3 / Bandar Parklands (Precinct 1 to Precinct 10)",
              "queryPlace": "Bandar Bukit Tinggi 3 / Bandar Parklands, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Bandar Botanic",
              "queryPlace": "Bandar Botanic, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Botanic Capital",
              "queryPlace": "Botanic Capital, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Ambang Botanic 1",
              "queryPlace": "Ambang Botanic 1, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Ambang Botanic 2",
              "queryPlace": "Ambang Botanic 2, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Botanic West & Central Lake Enclave",
              "queryPlace": "Botanic West & Central Lake Enclave, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Bandar Puteri Klang",
              "queryPlace": "Bandar Puteri Klang, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Jalan Sanggul",
              "queryPlace": "Jalan Sanggul, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Jalan Pending",
              "queryPlace": "Jalan Pending, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Jalan Kerongsang",
              "queryPlace": "Jalan Kerongsang, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Bandar Putera Klang & Bandar Putera 2",
              "queryPlace": "Bandar Putera Klang & Bandar Putera 2, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Bayuemas (Bandar Bayuemas)",
              "queryPlace": "Bayuemas, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Taman Klang Jaya",
              "queryPlace": "Taman Klang Jaya, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Taman Desa Utama",
              "queryPlace": "Taman Desa Utama, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Taman Desawan",
              "queryPlace": "Taman Desawan, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Taman Sentosa Klang",
              "queryPlace": "Taman Sentosa Klang, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Jalan Dato' Dagang",
              "queryPlace": "Jalan Dato' Dagang, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Jalan Hulubalang",
              "queryPlace": "Jalan Hulubalang, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Jalan Laksamana",
              "queryPlace": "Jalan Laksamana, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Jalan Bendahara",
              "queryPlace": "Jalan Bendahara, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Jalan Temenggung",
              "queryPlace": "Jalan Temenggung, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Jalan Raja Nong",
              "queryPlace": "Jalan Raja Nong, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Taman Sri Andalas",
              "queryPlace": "Taman Sri Andalas, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Jalan Seri Banang",
              "queryPlace": "Jalan Seri Banang, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Jalan Seri Damak",
              "queryPlace": "Jalan Seri Damak, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Jalan Seri Sarawak",
              "queryPlace": "Jalan Seri Sarawak, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Taman Rakyat Recreational Enclave",
              "queryPlace": "Taman Rakyat Recreational Enclave, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Glenmarie Cove",
              "queryPlace": "Glenmarie Cove, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Mygate",
              "queryPlace": "Mygate, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Lagoon Island",
              "queryPlace": "Lagoon Island, Bukit Tinggi & Botanic, Selangor"
            },
            {
              "name": "Swan Island",
              "queryPlace": "Swan Island, Bukit Tinggi & Botanic, Selangor"
            }
          ]
        },
        {
          "id": "selangor_klang_meru_klang_utara",
          "name": "Meru & Klang Utara",
          "fullName": "Klang Utara / North Klang & Meru Corridor (MBDK)",
          "queryPlace": "Meru & Klang Utara, Klang, Selangor",
          "tamans": [
            {
              "name": "Bandar Baru Klang (BBK)",
              "queryPlace": "Bandar Baru Klang, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Bukit Kuda",
              "queryPlace": "Bukit Kuda, Meru & Klang Utara, Selangor"
            },
            {
              "name": "BBK Commercial Hub & KPJ Klang Specialist",
              "queryPlace": "BBK Commercial Hub & KPJ Klang Specialist, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Berkeley",
              "queryPlace": "Taman Berkeley, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Eng Ann",
              "queryPlace": "Taman Eng Ann, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Rashna",
              "queryPlace": "Taman Rashna, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Sungai Rasau",
              "queryPlace": "Taman Sungai Rasau, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Kawasan Perindustrian Sungai Rasau",
              "queryPlace": "Kawasan Perindustrian Sungai Rasau, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Bandar Bukit Raja (BBR)",
              "queryPlace": "Bandar Bukit Raja, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Bandar Bukit Raja East (Athira, Casira)",
              "queryPlace": "Bandar Bukit Raja East, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Bandar Bukit Raja West (Kyra, Persada, Nadira)",
              "queryPlace": "Bandar Bukit Raja West, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Klang Utama",
              "queryPlace": "Taman Klang Utama, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Klang Perdana",
              "queryPlace": "Taman Klang Perdana, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Aman Perdana (Batu 5 Jalan Kapar)",
              "queryPlace": "Aman Perdana, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Perepat Indah",
              "queryPlace": "Taman Perepat Indah, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Rantau Panjang",
              "queryPlace": "Rantau Panjang, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Rantau Panjang",
              "queryPlace": "Taman Rantau Panjang, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Cempakasari",
              "queryPlace": "Taman Cempakasari, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Sri Rantau",
              "queryPlace": "Taman Sri Rantau, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Pekan Meru",
              "queryPlace": "Pekan Meru, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Meru",
              "queryPlace": "Taman Meru, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Saujana Meru",
              "queryPlace": "Taman Saujana Meru, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Meru Permai",
              "queryPlace": "Taman Meru Permai, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Meru Jaya",
              "queryPlace": "Taman Meru Jaya, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Meru Putra",
              "queryPlace": "Taman Meru Putra, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Seri Mewah",
              "queryPlace": "Taman Seri Mewah, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Sri Kencana",
              "queryPlace": "Taman Sri Kencana, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Desa Permai (Meru)",
              "queryPlace": "Taman Desa Permai, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Taman Daya Meru",
              "queryPlace": "Taman Daya Meru, Meru & Klang Utara, Selangor"
            },
            {
              "name": "Pekan Meru Commercial Center",
              "queryPlace": "Pekan Meru Commercial Center, Meru & Klang Utara, Selangor"
            }
          ]
        },
        {
          "id": "selangor_klang_kapar",
          "name": "Kapar",
          "fullName": "Kapar & Northern Industrial Zone (MBDK)",
          "queryPlace": "Kapar, Klang, Selangor",
          "tamans": [
            {
              "name": "Pekan Kapar (Kapar Town)",
              "queryPlace": "Pekan Kapar, Kapar, Selangor"
            },
            {
              "name": "Taman Sungai Kapar Indah (SKI)",
              "queryPlace": "Taman Sungai Kapar Indah, Kapar, Selangor"
            },
            {
              "name": "Taman Sementa Jaya & Sementa Permai",
              "queryPlace": "Taman Sementa Jaya & Sementa Permai, Kapar, Selangor"
            },
            {
              "name": "Taman Seri Sementa",
              "queryPlace": "Taman Seri Sementa, Kapar, Selangor"
            },
            {
              "name": "Taman Intan Jaya",
              "queryPlace": "Taman Intan Jaya, Kapar, Selangor"
            },
            {
              "name": "Taman Seri Kapar",
              "queryPlace": "Taman Seri Kapar, Kapar, Selangor"
            },
            {
              "name": "Taman Kapar Ria",
              "queryPlace": "Taman Kapar Ria, Kapar, Selangor"
            },
            {
              "name": "Taman Harum Manis",
              "queryPlace": "Taman Harum Manis, Kapar, Selangor"
            },
            {
              "name": "Taman Mewah Kapar",
              "queryPlace": "Taman Mewah Kapar, Kapar, Selangor"
            },
            {
              "name": "Taman Emas (Kapar)",
              "queryPlace": "Taman Emas, Kapar, Selangor"
            },
            {
              "name": "Taman Bukit Kapar",
              "queryPlace": "Taman Bukit Kapar, Kapar, Selangor"
            },
            {
              "name": "Kampung Sungai Pinang",
              "queryPlace": "Kampung Sungai Pinang, Kapar, Selangor"
            },
            {
              "name": "Tok Muda & Vallambrosa",
              "queryPlace": "Tok Muda & Vallambrosa, Kapar, Selangor"
            }
          ]
        },
        {
          "id": "selangor_klang_port_klang",
          "name": "Port Klang",
          "fullName": "Port Klang (Pelabuhan Klang) & Coastal Islands (MBDK)",
          "queryPlace": "Port Klang, Klang, Selangor",
          "tamans": [
            {
              "name": "Bandar Pelabuhan Klang (Port Klang CBD)",
              "queryPlace": "Bandar Pelabuhan Klang, Port Klang, Selangor"
            },
            {
              "name": "Southpoint Maritime Corridor",
              "queryPlace": "Southpoint Maritime Corridor, Port Klang, Selangor"
            },
            {
              "name": "Jalan Pelabuhan Utara",
              "queryPlace": "Jalan Pelabuhan Utara, Port Klang, Selangor"
            },
            {
              "name": "Pandamaran",
              "queryPlace": "Pandamaran, Port Klang, Selangor"
            },
            {
              "name": "Kampung Baru Pandamaran",
              "queryPlace": "Kampung Baru Pandamaran, Port Klang, Selangor"
            },
            {
              "name": "Pandamaran Jaya",
              "queryPlace": "Pandamaran Jaya, Port Klang, Selangor"
            },
            {
              "name": "Taman Pendamar Indah (1 & 2)",
              "queryPlace": "Taman Pendamar Indah, Port Klang, Selangor"
            },
            {
              "name": "Taman Tengku Badar",
              "queryPlace": "Taman Tengku Badar, Port Klang, Selangor"
            },
            {
              "name": "Kawasan Perindustrian Pandamaran",
              "queryPlace": "Kawasan Perindustrian Pandamaran, Port Klang, Selangor"
            },
            {
              "name": "Sobena Jaya Industrial Estate",
              "queryPlace": "Sobena Jaya Industrial Estate, Port Klang, Selangor"
            },
            {
              "name": "Telok Gong",
              "queryPlace": "Telok Gong, Port Klang, Selangor"
            },
            {
              "name": "Taman Telok Gong",
              "queryPlace": "Taman Telok Gong, Port Klang, Selangor"
            },
            {
              "name": "Kawasan Perindustrian Telok Gong",
              "queryPlace": "Kawasan Perindustrian Telok Gong, Port Klang, Selangor"
            },
            {
              "name": "Bandar Sultan Suleiman (Northport)",
              "queryPlace": "Bandar Sultan Suleiman, Port Klang, Selangor"
            },
            {
              "name": "Taman Sultan Suleiman",
              "queryPlace": "Taman Sultan Suleiman, Port Klang, Selangor"
            },
            {
              "name": "Kawasan Perusahaan Bandar Sultan Suleiman",
              "queryPlace": "Kawasan Perusahaan Bandar Sultan Suleiman, Port Klang, Selangor"
            },
            {
              "name": "Pulau Indah (Westport Gateway)",
              "queryPlace": "Pulau Indah, Port Klang, Selangor"
            },
            {
              "name": "Laguna Park",
              "queryPlace": "Laguna Park, Port Klang, Selangor"
            },
            {
              "name": "Bandar Armada Putra",
              "queryPlace": "Bandar Armada Putra, Port Klang, Selangor"
            },
            {
              "name": "Taman Perigi Nenas",
              "queryPlace": "Taman Perigi Nenas, Port Klang, Selangor"
            },
            {
              "name": "Pulau Indah Industrial Park (PIIP)",
              "queryPlace": "Pulau Indah Industrial Park, Port Klang, Selangor"
            },
            {
              "name": "Selangor Halal Hub",
              "queryPlace": "Selangor Halal Hub, Port Klang, Selangor"
            },
            {
              "name": "Pulau Ketam & Sungai Lima (Fishing Community Settlements)",
              "queryPlace": "Pulau Ketam & Sungai Lima, Port Klang, Selangor"
            }
          ]
        },
        {
          "id": "selangor_klang_kampung_jawa",
          "name": "Kampung Jawa",
          "fullName": "Kampung Jawa & Connaught Bridge Corridor",
          "queryPlace": "Kampung Jawa, Klang, Selangor",
          "tamans": [
            {
              "name": "Kampung Jawa",
              "queryPlace": "Kampung Jawa, Kampung Jawa, Selangor"
            },
            {
              "name": "Taman Maznah",
              "queryPlace": "Taman Maznah, Kampung Jawa, Selangor"
            },
            {
              "name": "Taman Shahbandar",
              "queryPlace": "Taman Shahbandar, Kampung Jawa, Selangor"
            },
            {
              "name": "Taman Menara Maju",
              "queryPlace": "Taman Menara Maju, Kampung Jawa, Selangor"
            },
            {
              "name": "Taman Sri Mewah (Jalan Kebun)",
              "queryPlace": "Taman Sri Mewah, Kampung Jawa, Selangor"
            },
            {
              "name": "Connaught Bridge Industrial Zone",
              "queryPlace": "Connaught Bridge Industrial Zone, Kampung Jawa, Selangor"
            }
          ]
        }
      ]
    },
    {
      "id": "selangor_hulu_langat",
      "num": 3,
      "name": "Hulu Langat",
      "state": "Selangor",
      "towns": [
        {
          "id": "selangor_hulu_langat_kajang",
          "name": "Kajang",
          "fullName": "Kajang Town Core & Suburbs (MPKj)",
          "queryPlace": "Kajang, Hulu Langat, Selangor",
          "tamans": [
            {
              "name": "Jalan Bukit Corridor",
              "queryPlace": "Jalan Bukit Corridor, Kajang, Selangor"
            },
            {
              "name": "Metro Point & Plaza Metro Kajang",
              "queryPlace": "Metro Point & Plaza Metro Kajang, Kajang, Selangor"
            },
            {
              "name": "Stadium Kajang Precinct",
              "queryPlace": "Stadium Kajang Precinct, Kajang, Selangor"
            },
            {
              "name": "Taman Berjaya",
              "queryPlace": "Taman Berjaya, Kajang, Selangor"
            },
            {
              "name": "Taman Kajang Indah",
              "queryPlace": "Taman Kajang Indah, Kajang, Selangor"
            },
            {
              "name": "Taman Sri Saga",
              "queryPlace": "Taman Sri Saga, Kajang, Selangor"
            },
            {
              "name": "Taman Sepakat Indah 1 & 2",
              "queryPlace": "Taman Sepakat Indah 1 & 2, Kajang, Selangor"
            },
            {
              "name": "Taman Sungai Chua",
              "queryPlace": "Taman Sungai Chua, Kajang, Selangor"
            },
            {
              "name": "Taman Kajang Utama",
              "queryPlace": "Taman Kajang Utama, Kajang, Selangor"
            },
            {
              "name": "Taman Bukit Mewah (Fasa 1 – 9)",
              "queryPlace": "Taman Bukit Mewah, Kajang, Selangor"
            },
            {
              "name": "Taman Kajang Mewah",
              "queryPlace": "Taman Kajang Mewah, Kajang, Selangor"
            },
            {
              "name": "Taman Prima Saujana (Seksyen 1 – 5)",
              "queryPlace": "Taman Prima Saujana, Kajang, Selangor"
            },
            {
              "name": "Impian Golf Resort",
              "queryPlace": "Impian Golf Resort, Kajang, Selangor"
            },
            {
              "name": "Impian Gemilang",
              "queryPlace": "Impian Gemilang, Kajang, Selangor"
            },
            {
              "name": "Impian Setia",
              "queryPlace": "Impian Setia, Kajang, Selangor"
            },
            {
              "name": "Impian Jaya",
              "queryPlace": "Impian Jaya, Kajang, Selangor"
            },
            {
              "name": "Impian Kasih",
              "queryPlace": "Impian Kasih, Kajang, Selangor"
            },
            {
              "name": "Impian Murni",
              "queryPlace": "Impian Murni, Kajang, Selangor"
            },
            {
              "name": "TTDI Grove Kajang (Zinnia, Azalea, Ellenia, Liana)",
              "queryPlace": "TTDI Grove Kajang, Kajang, Selangor"
            },
            {
              "name": "Kajang 2 (Kajang Dua)",
              "queryPlace": "Kajang 2, Kajang, Selangor"
            },
            {
              "name": "Jade Hills (Gamuda Jade Hills)",
              "queryPlace": "Jade Hills, Kajang, Selangor"
            },
            {
              "name": "Country Heights Kajang (Luxury Villa Enclave)",
              "queryPlace": "Country Heights Kajang, Kajang, Selangor"
            },
            {
              "name": "Tropicana Heights Kajang (Parkfield, Ridgefield, Fairfield)",
              "queryPlace": "Tropicana Heights Kajang, Kajang, Selangor"
            },
            {
              "name": "Nadayu92 Kajang",
              "queryPlace": "Nadayu92 Kajang, Kajang, Selangor"
            },
            {
              "name": "Taman Kajang Prima",
              "queryPlace": "Taman Kajang Prima, Kajang, Selangor"
            },
            {
              "name": "Taman Jasmin",
              "queryPlace": "Taman Jasmin, Kajang, Selangor"
            },
            {
              "name": "Taman Zamrud",
              "queryPlace": "Taman Zamrud, Kajang, Selangor"
            },
            {
              "name": "Taman Ria",
              "queryPlace": "Taman Ria, Kajang, Selangor"
            },
            {
              "name": "Taman Perkasa Indah",
              "queryPlace": "Taman Perkasa Indah, Kajang, Selangor"
            },
            {
              "name": "Taman Tenaga",
              "queryPlace": "Taman Tenaga, Kajang, Selangor"
            },
            {
              "name": "Taman Hiew Piow",
              "queryPlace": "Taman Hiew Piow, Kajang, Selangor"
            },
            {
              "name": "Sungai Ramal (Sungai Ramal Luar, Sungai Ramal Dalam, Country Villas)",
              "queryPlace": "Sungai Ramal, Kajang, Selangor"
            },
            {
              "name": "Sungai Kantan & Taman Sri Kantan",
              "queryPlace": "Sungai Kantan & Taman Sri Kantan, Kajang, Selangor"
            },
            {
              "name": "Bukit Cantik & Bukit Permai",
              "queryPlace": "Bukit Cantik & Bukit Permai, Kajang, Selangor"
            }
          ]
        },
        {
          "id": "selangor_hulu_langat_bandar_baru_bangi",
          "name": "Bandar Baru Bangi",
          "fullName": "Bandar Baru Bangi & South Bangi Corridor (MPKj)",
          "queryPlace": "Bandar Baru Bangi, Hulu Langat, Selangor",
          "tamans": [
            {
              "name": "Seksyen 1 (Commercial Zone)",
              "queryPlace": "Seksyen 1, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Seksyen 2",
              "queryPlace": "Seksyen 2, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Seksyen 3 (Taman Universiti Bangi border)",
              "queryPlace": "Seksyen 3, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Seksyen 4 & Seksyen 4 Tambahan",
              "queryPlace": "Seksyen 4 & Seksyen 4 Tambahan, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Seksyen 5 (Jalan Reko border)",
              "queryPlace": "Seksyen 5, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Seksyen 6",
              "queryPlace": "Seksyen 6, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Seksyen 7",
              "queryPlace": "Seksyen 7, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Seksyen 8",
              "queryPlace": "Seksyen 8, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Seksyen 9 (Pusat Bandar Bangi / EVO Mall / Sunway Gandaria)",
              "queryPlace": "Seksyen 9, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Seksyen 15 (Bangi Gateway & Kawasan Perindustrian Bangi)",
              "queryPlace": "Seksyen 15, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Seksyen 16",
              "queryPlace": "Seksyen 16, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Bangi Golf Resort",
              "queryPlace": "Bangi Golf Resort, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Bandar Seri Putra (Putra Terrace, Anjung Suasana, Vista Seri Putra)",
              "queryPlace": "Bandar Seri Putra, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Bandar Bukit Mahkota (Seksyen 1 – 9)",
              "queryPlace": "Bandar Bukit Mahkota, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Bandar Puteri Bangi (Almyra Residence, Kubica Square, Palmyra Residences)",
              "queryPlace": "Bandar Puteri Bangi, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Bangi Avenue (Avenue 1, 2, 3 / Bangi Wonderland Zone)",
              "queryPlace": "Bangi Avenue, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Southville City (Savanna Executive Suites, Avens Residence, Sensasi - Hulu Langat sector)",
              "queryPlace": "Southville City, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Taman Universiti Bangi",
              "queryPlace": "Taman Universiti Bangi, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Taman Bangi Villa",
              "queryPlace": "Taman Bangi Villa, Bandar Baru Bangi, Selangor"
            },
            {
              "name": "Kampung Bangi (Bangi Lama)",
              "queryPlace": "Kampung Bangi, Bandar Baru Bangi, Selangor"
            }
          ]
        },
        {
          "id": "selangor_hulu_langat_semenyih_beranang",
          "name": "Semenyih & Beranang",
          "fullName": "Semenyih & Beranang Growth Corridor (MPKj)",
          "queryPlace": "Semenyih & Beranang, Hulu Langat, Selangor",
          "tamans": [
            {
              "name": "Pekan Semenyih (Semenyih Town)",
              "queryPlace": "Pekan Semenyih, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Bandar Rinching (Seksyen 1 – 6)",
              "queryPlace": "Bandar Rinching, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Setia EcoHill & Setia EcoHill 2",
              "queryPlace": "Setia EcoHill & Setia EcoHill 2, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Horizon Residence",
              "queryPlace": "Horizon Residence, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Pallida",
              "queryPlace": "Pallida, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Begonia",
              "queryPlace": "Begonia, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Kingsville",
              "queryPlace": "Kingsville, Semenyih & Beranang, Selangor"
            },
            {
              "name": "EcoHill Taipan Commercial",
              "queryPlace": "EcoHill Taipan Commercial, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Eco Majestic",
              "queryPlace": "Eco Majestic, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Cradelton",
              "queryPlace": "Cradelton, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Tenderfield",
              "queryPlace": "Tenderfield, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Merrydale",
              "queryPlace": "Merrydale, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Stoneridge",
              "queryPlace": "Stoneridge, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Mellowood",
              "queryPlace": "Mellowood, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Harmoni",
              "queryPlace": "Harmoni, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Bandar Sunway Semenyih (Fasa 1 – 7)",
              "queryPlace": "Bandar Sunway Semenyih, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Diamond City Semenyih (Country Garden)",
              "queryPlace": "Diamond City Semenyih, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Taman Semenyih Mewah (Fasa 1 – 4 / The Greens)",
              "queryPlace": "Taman Semenyih Mewah, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Taman Pelangi Semenyih (1 & 2)",
              "queryPlace": "Taman Pelangi Semenyih, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Taman Semenyih Indah",
              "queryPlace": "Taman Semenyih Indah, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Taman Desa Semenyih",
              "queryPlace": "Taman Desa Semenyih, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Taman Dusun Jaya",
              "queryPlace": "Taman Dusun Jaya, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Taman Sri Semenyih",
              "queryPlace": "Taman Sri Semenyih, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Tiara South",
              "queryPlace": "Tiara South, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Sungai Tekali",
              "queryPlace": "Sungai Tekali, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Pekan Sungai Lalang",
              "queryPlace": "Pekan Sungai Lalang, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Kampung Pasir Mandi",
              "queryPlace": "Kampung Pasir Mandi, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Empangan Semenyih Enclave",
              "queryPlace": "Empangan Semenyih Enclave, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Pekan Beranang",
              "queryPlace": "Pekan Beranang, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Bandar Tasik Kesuma (Fasa 1 – 9)",
              "queryPlace": "Bandar Tasik Kesuma, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Mahkota Hills (Bandar Akademik Semenyih border)",
              "queryPlace": "Mahkota Hills, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Taman Kesuma Jaya",
              "queryPlace": "Taman Kesuma Jaya, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Taman Seri Beranang",
              "queryPlace": "Taman Seri Beranang, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Taman Beranang Jaya",
              "queryPlace": "Taman Beranang Jaya, Semenyih & Beranang, Selangor"
            },
            {
              "name": "Kawasan Perindustrian Beranang",
              "queryPlace": "Kawasan Perindustrian Beranang, Semenyih & Beranang, Selangor"
            }
          ]
        },
        {
          "id": "selangor_hulu_langat_cheras_south_balakong",
          "name": "Cheras South & Balakong",
          "fullName": "Cheras South & Balakong (Selangor / Hulu Langat Side - MPKj)",
          "queryPlace": "Cheras South & Balakong, Hulu Langat, Selangor",
          "tamans": [
            {
              "name": "Bandar Mahkota Cheras (Seksyen 1 to Seksyen 9, BMC Mall Corridor)",
              "queryPlace": "Bandar Mahkota Cheras, Cheras South & Balakong, Selangor"
            },
            {
              "name": "SL 1 to SL 14",
              "queryPlace": "SL 1 to SL 14, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Palm Walk",
              "queryPlace": "Palm Walk, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Green Haven",
              "queryPlace": "Green Haven, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Admiral Park",
              "queryPlace": "Admiral Park, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Twin Palms Sungai Long",
              "queryPlace": "Twin Palms Sungai Long, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Forest Green",
              "queryPlace": "Forest Green, Cheras South & Balakong, Selangor"
            },
            {
              "name": "UTAR Sungai Long Campus Enclave",
              "queryPlace": "UTAR Sungai Long Campus Enclave, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Suntex",
              "queryPlace": "Taman Suntex, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Cuepacs",
              "queryPlace": "Taman Cuepacs, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Segar Perdana",
              "queryPlace": "Taman Segar Perdana, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Bukit Segar (Selangor section)",
              "queryPlace": "Taman Bukit Segar, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Cheras Awana",
              "queryPlace": "Taman Cheras Awana, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Alam Jaya",
              "queryPlace": "Taman Alam Jaya, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Masria",
              "queryPlace": "Taman Masria, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Orkid",
              "queryPlace": "Taman Orkid, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Rasa Sayang",
              "queryPlace": "Taman Rasa Sayang, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Sri Mujur",
              "queryPlace": "Taman Sri Mujur, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Mudun",
              "queryPlace": "Taman Mudun, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Cheras Hartamas (Selangor section)",
              "queryPlace": "Taman Cheras Hartamas, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Ferngrove",
              "queryPlace": "Taman Ferngrove, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Cheras Perdana (CP 1 to CP 8)",
              "queryPlace": "Cheras Perdana, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Bandar Damai Perdana",
              "queryPlace": "Bandar Damai Perdana, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Tun Perak",
              "queryPlace": "Taman Tun Perak, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Bukit Belimbing",
              "queryPlace": "Taman Bukit Belimbing, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Cheras Jaya",
              "queryPlace": "Taman Cheras Jaya, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Taming Jaya",
              "queryPlace": "Taman Taming Jaya, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Balakong Jaya",
              "queryPlace": "Taman Balakong Jaya, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Impian Ehsan",
              "queryPlace": "Taman Impian Ehsan, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Desa Baiduri",
              "queryPlace": "Taman Desa Baiduri, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Minang & Taman Minang Ria",
              "queryPlace": "Taman Minang & Taman Minang Ria, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Bukit Angsana",
              "queryPlace": "Taman Bukit Angsana, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Cheras Vista",
              "queryPlace": "Taman Cheras Vista, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Juara Jaya",
              "queryPlace": "Taman Juara Jaya, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Seri Belimbing",
              "queryPlace": "Taman Seri Belimbing, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Sutera Cheras",
              "queryPlace": "Taman Sutera Cheras, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Taman Seri Cheras",
              "queryPlace": "Taman Seri Cheras, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Kawasan Perindustrian Balakong",
              "queryPlace": "Kawasan Perindustrian Balakong, Cheras South & Balakong, Selangor"
            },
            {
              "name": "Kampung Baru Balakong",
              "queryPlace": "Kampung Baru Balakong, Cheras South & Balakong, Selangor"
            }
          ]
        },
        {
          "id": "selangor_hulu_langat_ampang_jaya_pandan",
          "name": "Ampang Jaya & Pandan",
          "fullName": "Ampang Jaya & Pandan Corridor (Hulu Langat Side - MPAJ)",
          "queryPlace": "Ampang Jaya & Pandan, Hulu Langat, Selangor",
          "tamans": [
            {
              "name": "Pekan Ampang / Kampung Baru Ampang",
              "queryPlace": "Pekan Ampang / Kampung Baru Ampang, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Pandan Indah (Pandan Indah Commercial, Jalan Pandan Indah 1 – 30)",
              "queryPlace": "Pandan Indah, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Pandan Mewah (Hospital Ampang Zone)",
              "queryPlace": "Pandan Mewah, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Pandan Perdana (Pandan Lake Club)",
              "queryPlace": "Pandan Perdana, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Pandan Jaya",
              "queryPlace": "Pandan Jaya, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Dagang & Dagang Avenue",
              "queryPlace": "Taman Dagang & Dagang Avenue, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Kosas",
              "queryPlace": "Taman Kosas, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Rasmi Jaya",
              "queryPlace": "Taman Rasmi Jaya, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Bukit Indah (Ampang)",
              "queryPlace": "Taman Bukit Indah, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Ampang Indah",
              "queryPlace": "Taman Ampang Indah, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Ampang Mewah",
              "queryPlace": "Taman Ampang Mewah, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Ampang Campuran",
              "queryPlace": "Taman Ampang Campuran, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Sri Watan",
              "queryPlace": "Taman Sri Watan, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Seri Bayu",
              "queryPlace": "Taman Seri Bayu, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Tasik Tambahan",
              "queryPlace": "Taman Tasik Tambahan, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Lembah Maju",
              "queryPlace": "Taman Lembah Maju, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Bandar Baru Ampang",
              "queryPlace": "Bandar Baru Ampang, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Ampang Waterfront",
              "queryPlace": "Ampang Waterfront, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Mulia Jaya",
              "queryPlace": "Taman Mulia Jaya, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Bukit Teratai",
              "queryPlace": "Taman Bukit Teratai, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Muda",
              "queryPlace": "Taman Muda, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Taman Kencana",
              "queryPlace": "Taman Kencana, Ampang Jaya & Pandan, Selangor"
            },
            {
              "name": "Lembah Jaya (Lembah Jaya Selatan & Utara)",
              "queryPlace": "Lembah Jaya, Ampang Jaya & Pandan, Selangor"
            }
          ]
        },
        {
          "id": "selangor_hulu_langat_hulu_langat",
          "name": "Hulu Langat",
          "fullName": "Mukim Hulu Langat (Rural & Eco Enclave)",
          "queryPlace": "Hulu Langat, Hulu Langat, Selangor",
          "tamans": [
            {
              "name": "Pekan Batu 14 Hulu Langat",
              "queryPlace": "Pekan Batu 14 Hulu Langat, Hulu Langat, Selangor"
            },
            {
              "name": "Pekan Batu 18 Hulu Langat",
              "queryPlace": "Pekan Batu 18 Hulu Langat, Hulu Langat, Selangor"
            },
            {
              "name": "Dusun Tua (Hot Springs & Youth Skills Training Institute)",
              "queryPlace": "Dusun Tua, Hulu Langat, Selangor"
            },
            {
              "name": "Sungai Lui",
              "queryPlace": "Sungai Lui, Hulu Langat, Selangor"
            },
            {
              "name": "Pangsun & Mount Nuang Foothills",
              "queryPlace": "Pangsun & Mount Nuang Foothills, Hulu Langat, Selangor"
            },
            {
              "name": "Taman Seri Nanding",
              "queryPlace": "Taman Seri Nanding, Hulu Langat, Selangor"
            },
            {
              "name": "Taman Desa Sentosa",
              "queryPlace": "Taman Desa Sentosa, Hulu Langat, Selangor"
            },
            {
              "name": "Taman Desa Raya",
              "queryPlace": "Taman Desa Raya, Hulu Langat, Selangor"
            },
            {
              "name": "Taman Perkasa (Hulu Langat)",
              "queryPlace": "Taman Perkasa, Hulu Langat, Selangor"
            },
            {
              "name": "Taman Lagenda Suria",
              "queryPlace": "Taman Lagenda Suria, Hulu Langat, Selangor"
            },
            {
              "name": "Taman Sri Langat",
              "queryPlace": "Taman Sri Langat, Hulu Langat, Selangor"
            },
            {
              "name": "Taman Pinggiran Delima",
              "queryPlace": "Taman Pinggiran Delima, Hulu Langat, Selangor"
            }
          ]
        }
      ]
    },
    {
      "id": "selangor_gombak",
      "num": 4,
      "name": "Gombak",
      "state": "Selangor",
      "towns": [
        {
          "id": "selangor_gombak_selayang_kepong",
          "name": "Selayang & Kepong",
          "fullName": "Selayang & Kepong Border (MPS)",
          "queryPlace": "Selayang & Kepong, Gombak, Selangor",
          "tamans": [
            {
              "name": "Fasa 1, 2, 2A, 2B",
              "queryPlace": "Fasa 1, 2, 2A, 2B, Selayang & Kepong, Selangor"
            },
            {
              "name": "Dataran Templer",
              "queryPlace": "Dataran Templer, Selayang & Kepong, Selangor"
            },
            {
              "name": "Selayang Municipal Council (MPS) Headquarters Corridor",
              "queryPlace": "Selayang Municipal Council Headquarters Corridor, Selayang & Kepong, Selangor"
            },
            {
              "name": "Selayang Jaya",
              "queryPlace": "Selayang Jaya, Selayang & Kepong, Selangor"
            },
            {
              "name": "Selayang Utama",
              "queryPlace": "Selayang Utama, Selayang & Kepong, Selangor"
            },
            {
              "name": "Selayang Baru",
              "queryPlace": "Selayang Baru, Selayang & Kepong, Selangor"
            },
            {
              "name": "Selayang Indah & Selayang Pandang",
              "queryPlace": "Selayang Indah & Selayang Pandang, Selayang & Kepong, Selangor"
            },
            {
              "name": "Taman Bidara",
              "queryPlace": "Taman Bidara, Selayang & Kepong, Selangor"
            },
            {
              "name": "Taman Prima Selayang",
              "queryPlace": "Taman Prima Selayang, Selayang & Kepong, Selangor"
            },
            {
              "name": "Taman Selayang Mulia",
              "queryPlace": "Taman Selayang Mulia, Selayang & Kepong, Selangor"
            },
            {
              "name": "Taman Selayang Segar",
              "queryPlace": "Taman Selayang Segar, Selayang & Kepong, Selangor"
            },
            {
              "name": "Taman Selayang Sejati",
              "queryPlace": "Taman Selayang Sejati, Selayang & Kepong, Selangor"
            },
            {
              "name": "Taman Seri Selayang",
              "queryPlace": "Taman Seri Selayang, Selayang & Kepong, Selangor"
            },
            {
              "name": "One Selayang",
              "queryPlace": "One Selayang, Selayang & Kepong, Selangor"
            },
            {
              "name": "Taman Ehsan",
              "queryPlace": "Taman Ehsan, Selayang & Kepong, Selangor"
            },
            {
              "name": "Taman Desa Jaya",
              "queryPlace": "Taman Desa Jaya, Selayang & Kepong, Selangor"
            },
            {
              "name": "Taman Daya (Kepong)",
              "queryPlace": "Taman Daya, Selayang & Kepong, Selangor"
            },
            {
              "name": "Taman FRIM Kepong",
              "queryPlace": "Taman FRIM Kepong, Selayang & Kepong, Selangor"
            },
            {
              "name": "Kawasan Perindustrian Desa Aman",
              "queryPlace": "Kawasan Perindustrian Desa Aman, Selayang & Kepong, Selangor"
            }
          ]
        },
        {
          "id": "selangor_gombak_batu_caves_gombak_setia",
          "name": "Batu Caves & Gombak Setia",
          "fullName": "Batu Caves, Gombak Central & Gombak Setia (MPS)",
          "queryPlace": "Batu Caves & Gombak Setia, Gombak, Selangor",
          "tamans": [
            {
              "name": "Taman Sri Gombak",
              "queryPlace": "Taman Sri Gombak, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Fasa 1 to Fasa 10",
              "queryPlace": "Fasa 1 to Fasa 10, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Bukit Permata",
              "queryPlace": "Bukit Permata, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Pinggiran Permata",
              "queryPlace": "Pinggiran Permata, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Samudra & Taman Samudra Barat",
              "queryPlace": "Taman Samudra & Taman Samudra Barat, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Batu Caves",
              "queryPlace": "Taman Batu Caves, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Sunway Batu Caves",
              "queryPlace": "Sunway Batu Caves, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Amaniah",
              "queryPlace": "Taman Amaniah, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Medan Batu Caves",
              "queryPlace": "Taman Medan Batu Caves, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Greenwood",
              "queryPlace": "Taman Greenwood, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Selasih (Fasa 1 & 2)",
              "queryPlace": "Taman Selasih, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Hillcrest",
              "queryPlace": "Taman Hillcrest, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Pinggiran Batu Caves",
              "queryPlace": "Taman Pinggiran Batu Caves, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Industri Bolton",
              "queryPlace": "Taman Industri Bolton, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Gombak Permai",
              "queryPlace": "Taman Gombak Permai, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Astana Gemilang",
              "queryPlace": "Taman Astana Gemilang, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Berlian (Gombak)",
              "queryPlace": "Taman Berlian, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Seri Gombak Indah",
              "queryPlace": "Taman Seri Gombak Indah, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Melati (Selangor section)",
              "queryPlace": "Taman Melati, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Taman Sri Melati",
              "queryPlace": "Taman Sri Melati, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Kampung Changkat",
              "queryPlace": "Kampung Changkat, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Kampung Sungai Chinchin",
              "queryPlace": "Kampung Sungai Chinchin, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Kampung Simpang Tiga",
              "queryPlace": "Kampung Simpang Tiga, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Kampung Melayu Batu Caves",
              "queryPlace": "Kampung Melayu Batu Caves, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Kampung Wira Damai",
              "queryPlace": "Kampung Wira Damai, Batu Caves & Gombak Setia, Selangor"
            },
            {
              "name": "Kampung Sungai Tua & Sungai Tua Baharu",
              "queryPlace": "Kampung Sungai Tua & Sungai Tua Baharu, Batu Caves & Gombak Setia, Selangor"
            }
          ]
        },
        {
          "id": "selangor_gombak_melawati_ulu_kelang",
          "name": "Melawati & Ulu Kelang",
          "fullName": "Ulu Kelang & Melawati (MPAJ - Gombak District)",
          "queryPlace": "Melawati & Ulu Kelang, Gombak, Selangor",
          "tamans": [
            {
              "name": "Jalan G, Jalan A – M",
              "queryPlace": "Jalan G, Jalan A – M, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Melawati Mall Commercial Precinct",
              "queryPlace": "Melawati Mall Commercial Precinct, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Nadayu 63 & Nadayu 62",
              "queryPlace": "Nadayu 63 & Nadayu 62, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Taman Permata",
              "queryPlace": "Taman Permata, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Tiara Kemensah",
              "queryPlace": "Tiara Kemensah, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Embun Kemensah",
              "queryPlace": "Embun Kemensah, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Kemensah Mewah",
              "queryPlace": "Kemensah Mewah, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Ukay Perdana",
              "queryPlace": "Ukay Perdana, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Riverdale",
              "queryPlace": "Riverdale, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Kyoto Garden",
              "queryPlace": "Kyoto Garden, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Beverly Heights",
              "queryPlace": "Beverly Heights, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Wangsa Ukay",
              "queryPlace": "Wangsa Ukay, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Oakleaf Park",
              "queryPlace": "Oakleaf Park, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Villa Kelabang",
              "queryPlace": "Villa Kelabang, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Impian Selatan",
              "queryPlace": "Impian Selatan, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Taman Sierra Ukay",
              "queryPlace": "Taman Sierra Ukay, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Taman Ukay Bistari",
              "queryPlace": "Taman Ukay Bistari, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Sering Ukay",
              "queryPlace": "Sering Ukay, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Taman Bukit Mewah (Bukit Antarabangsa)",
              "queryPlace": "Taman Bukit Mewah, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Taman Hillview",
              "queryPlace": "Taman Hillview, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Taman Keramat (AU1 to AU5 - Selangor side)",
              "queryPlace": "Taman Keramat, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Lembah Keramat",
              "queryPlace": "Lembah Keramat, Melawati & Ulu Kelang, Selangor"
            },
            {
              "name": "Taman Zooview",
              "queryPlace": "Taman Zooview, Melawati & Ulu Kelang, Selangor"
            }
          ]
        },
        {
          "id": "selangor_gombak_rawang",
          "name": "Rawang",
          "fullName": "Rawang & Satellite Townships (MPS)",
          "queryPlace": "Rawang, Gombak, Selangor",
          "tamans": [
            {
              "name": "Bandar Country Homes (Fasa 1 to Fasa 13)",
              "queryPlace": "Bandar Country Homes, Rawang, Selangor"
            },
            {
              "name": "Emerald East",
              "queryPlace": "Emerald East, Rawang, Selangor"
            },
            {
              "name": "Emerald West",
              "queryPlace": "Emerald West, Rawang, Selangor"
            },
            {
              "name": "The Rise",
              "queryPlace": "The Rise, Rawang, Selangor"
            },
            {
              "name": "Precinct 1 to Precinct 8",
              "queryPlace": "Precinct 1 to Precinct 8, Rawang, Selangor"
            },
            {
              "name": "Acacia Park",
              "queryPlace": "Acacia Park, Rawang, Selangor"
            },
            {
              "name": "Seiring Residence",
              "queryPlace": "Seiring Residence, Rawang, Selangor"
            },
            {
              "name": "Saujana Rawang",
              "queryPlace": "Saujana Rawang, Rawang, Selangor"
            },
            {
              "name": "M Residence & M Residence 2",
              "queryPlace": "M Residence & M Residence 2, Rawang, Selangor"
            },
            {
              "name": "Rawang Walk",
              "queryPlace": "Rawang Walk, Rawang, Selangor"
            },
            {
              "name": "Plaza Rawang",
              "queryPlace": "Plaza Rawang, Rawang, Selangor"
            },
            {
              "name": "Taman Rawang Tin",
              "queryPlace": "Taman Rawang Tin, Rawang, Selangor"
            },
            {
              "name": "Taman Rawang Perdana (1 & 2)",
              "queryPlace": "Taman Rawang Perdana, Rawang, Selangor"
            },
            {
              "name": "Taman Bersatu",
              "queryPlace": "Taman Bersatu, Rawang, Selangor"
            },
            {
              "name": "Taman Bukit Rawang Putra",
              "queryPlace": "Taman Bukit Rawang Putra, Rawang, Selangor"
            },
            {
              "name": "Taman Seri Rawang",
              "queryPlace": "Taman Seri Rawang, Rawang, Selangor"
            },
            {
              "name": "Taman Garing & Taman Garing Utama",
              "queryPlace": "Taman Garing & Taman Garing Utama, Rawang, Selangor"
            },
            {
              "name": "Taman Tun Teja",
              "queryPlace": "Taman Tun Teja, Rawang, Selangor"
            },
            {
              "name": "Taman Kanching Jaya",
              "queryPlace": "Taman Kanching Jaya, Rawang, Selangor"
            },
            {
              "name": "Taman Pinggiran Pelangi",
              "queryPlace": "Taman Pinggiran Pelangi, Rawang, Selangor"
            },
            {
              "name": "Anggun City / Taman Anggun (Anggun 1, 2, 3)",
              "queryPlace": "Anggun City / Taman Anggun, Rawang, Selangor"
            },
            {
              "name": "Taman Velox",
              "queryPlace": "Taman Velox, Rawang, Selangor"
            },
            {
              "name": "Templer Park",
              "queryPlace": "Templer Park, Rawang, Selangor"
            },
            {
              "name": "Perangsang Templer Golf Club",
              "queryPlace": "Perangsang Templer Golf Club, Rawang, Selangor"
            },
            {
              "name": "Setia Eco Templer (Essex Gardens, Perola, Amalienburg)",
              "queryPlace": "Setia Eco Templer, Rawang, Selangor"
            }
          ]
        },
        {
          "id": "selangor_gombak_kuang_kundang_batu_arang",
          "name": "Kuang, Kundang & Batu Arang",
          "fullName": "Kuang, Kundang & Batu Arang (MPS)",
          "queryPlace": "Kuang, Kundang & Batu Arang, Gombak, Selangor",
          "tamans": [
            {
              "name": "Pekan Kuang",
              "queryPlace": "Pekan Kuang, Kuang, Kundang & Batu Arang, Selangor"
            },
            {
              "name": "Kundang Town (Pengkalan Kundang)",
              "queryPlace": "Kundang Town, Kuang, Kundang & Batu Arang, Selangor"
            },
            {
              "name": "Bandar Baru Kundang",
              "queryPlace": "Bandar Baru Kundang, Kuang, Kundang & Batu Arang, Selangor"
            },
            {
              "name": "Kundang Jaya Industrial Park",
              "queryPlace": "Kundang Jaya Industrial Park, Kuang, Kundang & Batu Arang, Selangor"
            },
            {
              "name": "Village Homes",
              "queryPlace": "Village Homes, Kuang, Kundang & Batu Arang, Selangor"
            },
            {
              "name": "Valeria",
              "queryPlace": "Valeria, Kuang, Kundang & Batu Arang, Selangor"
            },
            {
              "name": "Joya",
              "queryPlace": "Joya, Kuang, Kundang & Batu Arang, Selangor"
            },
            {
              "name": "Gardens Square",
              "queryPlace": "Gardens Square, Kuang, Kundang & Batu Arang, Selangor"
            },
            {
              "name": "Taman Kundang Lestari",
              "queryPlace": "Taman Kundang Lestari, Kuang, Kundang & Batu Arang, Selangor"
            },
            {
              "name": "Kampung Melayu Sri Kundang",
              "queryPlace": "Kampung Melayu Sri Kundang, Kuang, Kundang & Batu Arang, Selangor"
            },
            {
              "name": "Pekan Batu Arang",
              "queryPlace": "Pekan Batu Arang, Kuang, Kundang & Batu Arang, Selangor"
            },
            {
              "name": "Taman Batu Arang",
              "queryPlace": "Taman Batu Arang, Kuang, Kundang & Batu Arang, Selangor"
            },
            {
              "name": "Kampung Baru Batu Arang",
              "queryPlace": "Kampung Baru Batu Arang, Kuang, Kundang & Batu Arang, Selangor"
            }
          ]
        },
        {
          "id": "selangor_gombak_sungai_buloh",
          "name": "Sungai Buloh",
          "fullName": "Sungai Buloh (Gombak Portion - MPS)",
          "queryPlace": "Sungai Buloh, Gombak, Selangor",
          "tamans": [
            {
              "name": "Bandar Baru Sungai Buloh (Fasa 1 – 4)",
              "queryPlace": "Bandar Baru Sungai Buloh, Sungai Buloh, Selangor"
            },
            {
              "name": "BRP 1 to BRP 10",
              "queryPlace": "BRP 1 to BRP 10, Sungai Buloh, Selangor"
            },
            {
              "name": "Bukit Rahman Putra Golf Club",
              "queryPlace": "Bukit Rahman Putra Golf Club, Sungai Buloh, Selangor"
            },
            {
              "name": "Sierramas West",
              "queryPlace": "Sierramas West, Sungai Buloh, Selangor"
            },
            {
              "name": "Sierramas Heights",
              "queryPlace": "Sierramas Heights, Sungai Buloh, Selangor"
            },
            {
              "name": "Valencia (Luxury Gated Golf Community)",
              "queryPlace": "Valencia, Sungai Buloh, Selangor"
            },
            {
              "name": "Taman Villa Putra",
              "queryPlace": "Taman Villa Putra, Sungai Buloh, Selangor"
            },
            {
              "name": "Taman Saujana Akasia",
              "queryPlace": "Taman Saujana Akasia, Sungai Buloh, Selangor"
            },
            {
              "name": "Kampung Baru Sungai Buloh (Gombak administrative boundary)",
              "queryPlace": "Kampung Baru Sungai Buloh, Sungai Buloh, Selangor"
            }
          ]
        }
      ]
    },
    {
      "id": "selangor_sepang",
      "num": 5,
      "name": "Sepang",
      "state": "Selangor",
      "towns": [
        {
          "id": "selangor_sepang_cyberjaya",
          "name": "Cyberjaya",
          "fullName": "Cyberjaya (Smart City & Technology Hub)",
          "queryPlace": "Cyberjaya, Sepang, Selangor",
          "tamans": [
            {
              "name": "Cyber 1 (Central Business District / Prima Avenue)",
              "queryPlace": "Cyber 1, Cyberjaya, Selangor"
            },
            {
              "name": "Cyber 2 & 3",
              "queryPlace": "Cyber 2 & 3, Cyberjaya, Selangor"
            },
            {
              "name": "Cyber 4 (Multimedia University - MMU Corridor)",
              "queryPlace": "Cyber 4, Cyberjaya, Selangor"
            },
            {
              "name": "Cyber 5 & 6",
              "queryPlace": "Cyber 5 & 6, Cyberjaya, Selangor"
            },
            {
              "name": "Cyber 7 & 8",
              "queryPlace": "Cyber 7 & 8, Cyberjaya, Selangor"
            },
            {
              "name": "Cyber 9",
              "queryPlace": "Cyber 9, Cyberjaya, Selangor"
            },
            {
              "name": "Cyber 10 (Symphony Park, Aspire Residence, Masreca 19)",
              "queryPlace": "Cyber 10, Cyberjaya, Selangor"
            },
            {
              "name": "Cyber 11 & 12",
              "queryPlace": "Cyber 11 & 12, Cyberjaya, Selangor"
            },
            {
              "name": "Lakefront @ Cyberjaya (Lakefront Homes, Lakefront Villa, Lakefront Residence)",
              "queryPlace": "Lakefront @ Cyberjaya, Cyberjaya, Selangor"
            },
            {
              "name": "Mirage by the Lake",
              "queryPlace": "Mirage by the Lake, Cyberjaya, Selangor"
            },
            {
              "name": "Cyber Heights Villa",
              "queryPlace": "Cyber Heights Villa, Cyberjaya, Selangor"
            },
            {
              "name": "Sejati Residences & Sejati Lakeside",
              "queryPlace": "Sejati Residences & Sejati Lakeside, Cyberjaya, Selangor"
            },
            {
              "name": "Symphony Hills (Schumann, Beethoven, Mozart, Schubert)",
              "queryPlace": "Symphony Hills, Cyberjaya, Selangor"
            },
            {
              "name": "Tamarind Square",
              "queryPlace": "Tamarind Square, Cyberjaya, Selangor"
            },
            {
              "name": "Shaftsbury Square",
              "queryPlace": "Shaftsbury Square, Cyberjaya, Selangor"
            },
            {
              "name": "Eclipse Residence / Pan'gaea",
              "queryPlace": "Eclipse Residence / Pan'gaea, Cyberjaya, Selangor"
            },
            {
              "name": "The Mulia Residences",
              "queryPlace": "The Mulia Residences, Cyberjaya, Selangor"
            },
            {
              "name": "Verdi Eco-dominiums",
              "queryPlace": "Verdi Eco-dominiums, Cyberjaya, Selangor"
            },
            {
              "name": "Edusphere Cyberjaya",
              "queryPlace": "Edusphere Cyberjaya, Cyberjaya, Selangor"
            },
            {
              "name": "DPULZE Environs",
              "queryPlace": "DPULZE Environs, Cyberjaya, Selangor"
            }
          ]
        },
        {
          "id": "selangor_sepang_dengkil_cybersouth",
          "name": "Dengkil & Cybersouth",
          "fullName": "Dengkil & Cybersouth Growth Corridor",
          "queryPlace": "Dengkil & Cybersouth, Sepang, Selangor",
          "tamans": [
            {
              "name": "Pekan Dengkil (Dengkil Town)",
              "queryPlace": "Pekan Dengkil, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "KITA @ Cybersouth (KITA Bayu, KITA Harmoni, KITA Ria, KITA Mesra)",
              "queryPlace": "KITA @ Cybersouth, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Casa View",
              "queryPlace": "Casa View, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Green Casa",
              "queryPlace": "Green Casa, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Belimbing",
              "queryPlace": "Belimbing, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Bell Avenue & Bell Suites",
              "queryPlace": "Bell Avenue & Bell Suites, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "The Olive",
              "queryPlace": "The Olive, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Monet Garden, Monet SpringArt, Monet Lily",
              "queryPlace": "Monet Garden, Monet SpringArt, Monet Lily, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Tangerine Suites",
              "queryPlace": "Tangerine Suites, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Xiamen University Malaysia Campus Zone",
              "queryPlace": "Xiamen University Malaysia Campus Zone, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Serenia Amani",
              "queryPlace": "Serenia Amani, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Serenia Arana",
              "queryPlace": "Serenia Arana, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Serenia Anisa",
              "queryPlace": "Serenia Anisa, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Serenia Aiora",
              "queryPlace": "Serenia Aiora, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Serenia Aqila",
              "queryPlace": "Serenia Aqila, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Southville City (Sepang/Dengkil portion)",
              "queryPlace": "Southville City, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Savanna Executive Suites",
              "queryPlace": "Savanna Executive Suites, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Avens Residence",
              "queryPlace": "Avens Residence, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Sensasi",
              "queryPlace": "Sensasi, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Taman Dengkil Jaya",
              "queryPlace": "Taman Dengkil Jaya, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Taman Emas (Dengkil)",
              "queryPlace": "Taman Emas, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Taman Nilam",
              "queryPlace": "Taman Nilam, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Taman Baiduri",
              "queryPlace": "Taman Baiduri, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Taman Desa Dengkil",
              "queryPlace": "Taman Desa Dengkil, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Taman Kristal",
              "queryPlace": "Taman Kristal, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Taman Arowana",
              "queryPlace": "Taman Arowana, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Taman Jenderam Damai",
              "queryPlace": "Taman Jenderam Damai, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Taman Jenderam Lestari",
              "queryPlace": "Taman Jenderam Lestari, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Kampung Dato' Ahmad Razali",
              "queryPlace": "Kampung Dato' Ahmad Razali, Dengkil & Cybersouth, Selangor"
            },
            {
              "name": "Jenderam Hilir & Jenderam Hulu",
              "queryPlace": "Jenderam Hilir & Jenderam Hulu, Dengkil & Cybersouth, Selangor"
            }
          ]
        },
        {
          "id": "selangor_sepang_salak_tinggi_kota_warisan",
          "name": "Salak Tinggi & Kota Warisan",
          "fullName": "Bandar Baru Salak Tinggi (BBST) & Kota Warisan",
          "queryPlace": "Salak Tinggi & Kota Warisan, Sepang, Selangor",
          "tamans": [
            {
              "name": "Warisan Puteri (Evira, Ayanna, Bella, Verona)",
              "queryPlace": "Warisan Puteri, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Warisan Hijauan",
              "queryPlace": "Taman Warisan Hijauan, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Saujana KLIA",
              "queryPlace": "Taman Saujana KLIA, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Intan Baiduri (Sepang)",
              "queryPlace": "Taman Intan Baiduri, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "KIP Sentral Kota Warisan",
              "queryPlace": "KIP Sentral Kota Warisan, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Salak Tinggi ERL Station Corridor",
              "queryPlace": "Salak Tinggi ERL Station Corridor, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Salak Perdana (Medan 120)",
              "queryPlace": "Taman Salak Perdana, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Dahlia",
              "queryPlace": "Taman Dahlia, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Seroja",
              "queryPlace": "Taman Seroja, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Mawar (Fasa 1 & 2)",
              "queryPlace": "Taman Mawar, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Teratai",
              "queryPlace": "Taman Teratai, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Bunga Raya",
              "queryPlace": "Taman Bunga Raya, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Salak Kasturi",
              "queryPlace": "Taman Salak Kasturi, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Salak Suria",
              "queryPlace": "Taman Salak Suria, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Desa Salak Maju",
              "queryPlace": "Taman Desa Salak Maju, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "M Senyum (Mah Sing Salak Tinggi)",
              "queryPlace": "M Senyum, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Selasih",
              "queryPlace": "Taman Selasih, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Taman Desa Vista",
              "queryPlace": "Taman Desa Vista, Salak Tinggi & Kota Warisan, Selangor"
            },
            {
              "name": "Kawasan Institusi & Mahkamah BBST",
              "queryPlace": "Kawasan Institusi & Mahkamah BBST, Salak Tinggi & Kota Warisan, Selangor"
            }
          ]
        },
        {
          "id": "selangor_sepang_klia_sepang_coast",
          "name": "KLIA & Sepang Coast",
          "fullName": "KLIA Corridor, Putra Perdana & Coastal Sepang",
          "queryPlace": "KLIA & Sepang Coast, Sepang, Selangor",
          "tamans": [
            {
              "name": "Taman Putra Perdana (Puchong-Sepang Border)",
              "queryPlace": "Taman Putra Perdana, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "La Cottage",
              "queryPlace": "La Cottage, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Ruvena Villa",
              "queryPlace": "Ruvena Villa, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Alpha, Beta, Elegan Apartments",
              "queryPlace": "Alpha, Beta, Elegan Apartments, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Taman Mas Sepang",
              "queryPlace": "Taman Mas Sepang, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "KLIA Aeropolis",
              "queryPlace": "KLIA Aeropolis, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Mitsui Outlet Park KLIA",
              "queryPlace": "Mitsui Outlet Park KLIA, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Cargo City & Free Commercial Zone",
              "queryPlace": "Cargo City & Free Commercial Zone, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Pekan Sepang (Sepang Old Town)",
              "queryPlace": "Pekan Sepang, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Pekan Sungai Pelek",
              "queryPlace": "Pekan Sungai Pelek, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Taman Aman (Sungai Pelek)",
              "queryPlace": "Taman Aman, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Taman Sri Sungai Pelek",
              "queryPlace": "Taman Sri Sungai Pelek, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Taman Ria",
              "queryPlace": "Taman Ria, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Taman Muhibbah (Sungai Pelek)",
              "queryPlace": "Taman Muhibbah, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Taman Sri Bayu",
              "queryPlace": "Taman Sri Bayu, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Kampung Baru Sungai Pelek",
              "queryPlace": "Kampung Baru Sungai Pelek, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Avani Sepang Goldcoast Resort",
              "queryPlace": "Avani Sepang Goldcoast Resort, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Kampung Bagan Lalang",
              "queryPlace": "Kampung Bagan Lalang, KLIA & Sepang Coast, Selangor"
            },
            {
              "name": "Bagan Lalang Coastal Strip",
              "queryPlace": "Bagan Lalang Coastal Strip, KLIA & Sepang Coast, Selangor"
            }
          ]
        }
      ]
    },
    {
      "id": "selangor_kuala_langat",
      "num": 6,
      "name": "Kuala Langat",
      "state": "Selangor",
      "towns": [
        {
          "id": "selangor_kuala_langat_banting",
          "name": "Banting",
          "fullName": "Banting Town & Urban Environs (MPKL)",
          "queryPlace": "Banting, Kuala Langat, Selangor",
          "tamans": [
            {
              "name": "Pusat Bandar Banting",
              "queryPlace": "Pusat Bandar Banting, Banting, Selangor"
            },
            {
              "name": "Bandar Sungai Emas",
              "queryPlace": "Bandar Sungai Emas, Banting, Selangor"
            },
            {
              "name": "Bandar Mahkota Banting",
              "queryPlace": "Bandar Mahkota Banting, Banting, Selangor"
            },
            {
              "name": "Taman Langat Jaya",
              "queryPlace": "Taman Langat Jaya, Banting, Selangor"
            },
            {
              "name": "Taman Langat Utama (1 & 2)",
              "queryPlace": "Taman Langat Utama, Banting, Selangor"
            },
            {
              "name": "Taman Seri Telok Datok",
              "queryPlace": "Taman Seri Telok Datok, Banting, Selangor"
            },
            {
              "name": "Taman Seri Putera",
              "queryPlace": "Taman Seri Putera, Banting, Selangor"
            },
            {
              "name": "Taman Bakti",
              "queryPlace": "Taman Bakti, Banting, Selangor"
            },
            {
              "name": "Taman Delima",
              "queryPlace": "Taman Delima, Banting, Selangor"
            },
            {
              "name": "Taman Periang",
              "queryPlace": "Taman Periang, Banting, Selangor"
            },
            {
              "name": "Taman Muhibbah (Banting)",
              "queryPlace": "Taman Muhibbah, Banting, Selangor"
            },
            {
              "name": "Taman Sari Banting",
              "queryPlace": "Taman Sari Banting, Banting, Selangor"
            },
            {
              "name": "Taman Bayu Indah",
              "queryPlace": "Taman Bayu Indah, Banting, Selangor"
            },
            {
              "name": "Taman Cempaka (Banting)",
              "queryPlace": "Taman Cempaka, Banting, Selangor"
            },
            {
              "name": "Taman Banting Baru",
              "queryPlace": "Taman Banting Baru, Banting, Selangor"
            },
            {
              "name": "Taman Telok Datok",
              "queryPlace": "Taman Telok Datok, Banting, Selangor"
            },
            {
              "name": "Taman Gembira (Banting)",
              "queryPlace": "Taman Gembira, Banting, Selangor"
            },
            {
              "name": "Taman Banting Mewah",
              "queryPlace": "Taman Banting Mewah, Banting, Selangor"
            },
            {
              "name": "Pekan Telok Datok",
              "queryPlace": "Pekan Telok Datok, Banting, Selangor"
            },
            {
              "name": "Pekan Kanchong Darat",
              "queryPlace": "Pekan Kanchong Darat, Banting, Selangor"
            },
            {
              "name": "Pekan Chodoi",
              "queryPlace": "Pekan Chodoi, Banting, Selangor"
            },
            {
              "name": "Pekan Permatang Pasir",
              "queryPlace": "Pekan Permatang Pasir, Banting, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_langat_bukit_changgang",
          "name": "Bukit Changgang",
          "fullName": "Bukit Changgang & Langat Murni Corridor (Mukim Tanjong Duabelas)",
          "queryPlace": "Bukit Changgang, Kuala Langat, Selangor",
          "tamans": [
            {
              "name": "Kampung Bukit Changgang",
              "queryPlace": "Kampung Bukit Changgang, Bukit Changgang, Selangor"
            },
            {
              "name": "Rancangan Tanah Belia (RTB) Bukit Changgang",
              "queryPlace": "Rancangan Tanah Belia Bukit Changgang, Bukit Changgang, Selangor"
            },
            {
              "name": "Taman Changgang Jaya",
              "queryPlace": "Taman Changgang Jaya, Bukit Changgang, Selangor"
            },
            {
              "name": "Taman Langat Murni (Fasa 1 & 2)",
              "queryPlace": "Taman Langat Murni, Bukit Changgang, Selangor"
            },
            {
              "name": "Taman Langat Utama 2",
              "queryPlace": "Taman Langat Utama 2, Bukit Changgang, Selangor"
            },
            {
              "name": "Kawasan Perindustrian Bukit Changgang",
              "queryPlace": "Kawasan Perindustrian Bukit Changgang, Bukit Changgang, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_langat_telok_panglima_garang_rimbayu",
          "name": "Telok Panglima Garang & Rimbayu",
          "fullName": "Telok Panglima Garang (TPG) & Integrated Townships (MPKL)",
          "queryPlace": "Telok Panglima Garang & Rimbayu, Kuala Langat, Selangor",
          "tamans": [
            {
              "name": "The Chimes",
              "queryPlace": "The Chimes, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Perennia",
              "queryPlace": "Perennia, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Periwinkle",
              "queryPlace": "Periwinkle, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Scarlet",
              "queryPlace": "Scarlet, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Wisteria",
              "queryPlace": "Wisteria, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Livia",
              "queryPlace": "Livia, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Swans",
              "queryPlace": "Swans, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Starling",
              "queryPlace": "Starling, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Robin",
              "queryPlace": "Robin, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Blossom Square Commercial",
              "queryPlace": "Blossom Square Commercial, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Monterey",
              "queryPlace": "Monterey, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Terraza",
              "queryPlace": "Terraza, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Grandezza",
              "queryPlace": "Grandezza, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "The Parque Residences",
              "queryPlace": "The Parque Residences, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Eco Sanctuary Mall",
              "queryPlace": "Eco Sanctuary Mall, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Arahsia",
              "queryPlace": "Arahsia, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Bayan",
              "queryPlace": "Bayan, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Cheria",
              "queryPlace": "Cheria, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Dalia",
              "queryPlace": "Dalia, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Freesia",
              "queryPlace": "Freesia, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Sinaria & Triana Commercial",
              "queryPlace": "Sinaria & Triana Commercial, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Lucent Residence",
              "queryPlace": "Lucent Residence, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Luxura",
              "queryPlace": "Luxura, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "The Amber Residences",
              "queryPlace": "The Amber Residences, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Quayside Mall Corridor",
              "queryPlace": "Quayside Mall Corridor, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Taman Dato' Hormat",
              "queryPlace": "Taman Dato' Hormat, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Taman Telok Mengkuang",
              "queryPlace": "Taman Telok Mengkuang, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Taman Medan Jaya",
              "queryPlace": "Taman Medan Jaya, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Taman Srikandi",
              "queryPlace": "Taman Srikandi, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Taman Bestari (TPG)",
              "queryPlace": "Taman Bestari, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Taman Bentara",
              "queryPlace": "Taman Bentara, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Taman Panglima",
              "queryPlace": "Taman Panglima, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Taman Desa Kemandur",
              "queryPlace": "Taman Desa Kemandur, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Taman Perwira",
              "queryPlace": "Taman Perwira, Telok Panglima Garang & Rimbayu, Selangor"
            },
            {
              "name": "Telok Mengkuang Industrial Estate",
              "queryPlace": "Telok Mengkuang Industrial Estate, Telok Panglima Garang & Rimbayu, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_langat_jenjarom",
          "name": "Jenjarom",
          "fullName": "Jenjarom (MPKL)",
          "queryPlace": "Jenjarom, Kuala Langat, Selangor",
          "tamans": [
            {
              "name": "Pekan Jenjarom (Kampung Baru Jenjarom / Fo Guang Shan Dong Zen Precinct)",
              "queryPlace": "Pekan Jenjarom, Jenjarom, Selangor"
            },
            {
              "name": "Taman Sejahtera (Jenjarom)",
              "queryPlace": "Taman Sejahtera, Jenjarom, Selangor"
            },
            {
              "name": "Taman Rambai Indah",
              "queryPlace": "Taman Rambai Indah, Jenjarom, Selangor"
            },
            {
              "name": "Taman Desa Jarom",
              "queryPlace": "Taman Desa Jarom, Jenjarom, Selangor"
            },
            {
              "name": "Taman Sri Jarom & Taman Sri Jarom 2",
              "queryPlace": "Taman Sri Jarom & Taman Sri Jarom 2, Jenjarom, Selangor"
            },
            {
              "name": "Taman Yayasan",
              "queryPlace": "Taman Yayasan, Jenjarom, Selangor"
            },
            {
              "name": "Taman Melati (Jenjarom)",
              "queryPlace": "Taman Melati, Jenjarom, Selangor"
            },
            {
              "name": "Taman Ria (Jenjarom)",
              "queryPlace": "Taman Ria, Jenjarom, Selangor"
            },
            {
              "name": "Taman Ikhlas",
              "queryPlace": "Taman Ikhlas, Jenjarom, Selangor"
            },
            {
              "name": "Scientex Jenjarom",
              "queryPlace": "Scientex Jenjarom, Jenjarom, Selangor"
            },
            {
              "name": "Taman Jenjarom Jaya",
              "queryPlace": "Taman Jenjarom Jaya, Jenjarom, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_langat_bandar_saujana_putra",
          "name": "Bandar Saujana Putra",
          "fullName": "Bandar Saujana Putra (BSP - MPKL)",
          "queryPlace": "Bandar Saujana Putra, Kuala Langat, Selangor",
          "tamans": [
            {
              "name": "BSP 21 (Multi-tower Serviced Residences)",
              "queryPlace": "BSP 21, Bandar Saujana Putra, Selangor"
            },
            {
              "name": "BSP Skypark",
              "queryPlace": "BSP Skypark, Bandar Saujana Putra, Selangor"
            },
            {
              "name": "Royal Garden",
              "queryPlace": "Royal Garden, Bandar Saujana Putra, Selangor"
            },
            {
              "name": "Royal Ivory (1 & 2)",
              "queryPlace": "Royal Ivory, Bandar Saujana Putra, Selangor"
            },
            {
              "name": "Magenta Homes",
              "queryPlace": "Magenta Homes, Bandar Saujana Putra, Selangor"
            },
            {
              "name": "Ivory Residences",
              "queryPlace": "Ivory Residences, Bandar Saujana Putra, Selangor"
            },
            {
              "name": "Indigo Homes",
              "queryPlace": "Indigo Homes, Bandar Saujana Putra, Selangor"
            },
            {
              "name": "Camellia Cottage",
              "queryPlace": "Camellia Cottage, Bandar Saujana Putra, Selangor"
            },
            {
              "name": "Pearl Villa & Pearl Indah",
              "queryPlace": "Pearl Villa & Pearl Indah, Bandar Saujana Putra, Selangor"
            },
            {
              "name": "Rumah Pangsa Impian",
              "queryPlace": "Rumah Pangsa Impian, Bandar Saujana Putra, Selangor"
            },
            {
              "name": "One BSP Commercial Hub",
              "queryPlace": "One BSP Commercial Hub, Bandar Saujana Putra, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_langat_sijangkang_pulau_carey",
          "name": "Sijangkang & Pulau Carey",
          "fullName": "Sijangkang & Pulau Carey (MPKL)",
          "queryPlace": "Sijangkang & Pulau Carey, Kuala Langat, Selangor",
          "tamans": [
            {
              "name": "Kampung Sijangkang",
              "queryPlace": "Kampung Sijangkang, Sijangkang & Pulau Carey, Selangor"
            },
            {
              "name": "Taman Permai Sijangkang",
              "queryPlace": "Taman Permai Sijangkang, Sijangkang & Pulau Carey, Selangor"
            },
            {
              "name": "Taman Sijangkang Indah",
              "queryPlace": "Taman Sijangkang Indah, Sijangkang & Pulau Carey, Selangor"
            },
            {
              "name": "Taman Medan Indah",
              "queryPlace": "Taman Medan Indah, Sijangkang & Pulau Carey, Selangor"
            },
            {
              "name": "Taman Seri Medan",
              "queryPlace": "Taman Seri Medan, Sijangkang & Pulau Carey, Selangor"
            },
            {
              "name": "Taman Sri Putra (Sijangkang)",
              "queryPlace": "Taman Sri Putra, Sijangkang & Pulau Carey, Selangor"
            },
            {
              "name": "Kawasan Perindustrian Sijangkang",
              "queryPlace": "Kawasan Perindustrian Sijangkang, Sijangkang & Pulau Carey, Selangor"
            },
            {
              "name": "Mah Meri Cultural Village",
              "queryPlace": "Mah Meri Cultural Village, Sijangkang & Pulau Carey, Selangor"
            },
            {
              "name": "Ladang Carey settlements (West & South)",
              "queryPlace": "Ladang Carey settlements, Sijangkang & Pulau Carey, Selangor"
            },
            {
              "name": "Carey Island Port Corridor",
              "queryPlace": "Carey Island Port Corridor, Sijangkang & Pulau Carey, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_langat_morib_tanjung_sepat",
          "name": "Morib & Tanjung Sepat",
          "fullName": "Morib, Jugra & Tanjung Sepat",
          "queryPlace": "Morib & Tanjung Sepat, Kuala Langat, Selangor",
          "tamans": [
            {
              "name": "Morib Gold Coast Resort",
              "queryPlace": "Morib Gold Coast Resort, Morib & Tanjung Sepat, Selangor"
            },
            {
              "name": "Taman Morib Bay",
              "queryPlace": "Taman Morib Bay, Morib & Tanjung Sepat, Selangor"
            },
            {
              "name": "Pekan Morib",
              "queryPlace": "Pekan Morib, Morib & Tanjung Sepat, Selangor"
            },
            {
              "name": "Jugra (Bukit Jugra, Makam Sultan Abdul Samad, Istana Bandar)",
              "queryPlace": "Jugra, Morib & Tanjung Sepat, Selangor"
            },
            {
              "name": "Pantai Kelanang",
              "queryPlace": "Pantai Kelanang, Morib & Tanjung Sepat, Selangor"
            },
            {
              "name": "Pekan Tanjung Sepat",
              "queryPlace": "Pekan Tanjung Sepat, Morib & Tanjung Sepat, Selangor"
            },
            {
              "name": "Taman Tanjung Sepat Indah",
              "queryPlace": "Taman Tanjung Sepat Indah, Morib & Tanjung Sepat, Selangor"
            },
            {
              "name": "Taman Mutiara Tanjung Sepat",
              "queryPlace": "Taman Mutiara Tanjung Sepat, Morib & Tanjung Sepat, Selangor"
            },
            {
              "name": "Taman Nelayan",
              "queryPlace": "Taman Nelayan, Morib & Tanjung Sepat, Selangor"
            },
            {
              "name": "Kampung Baru Tanjung Sepat",
              "queryPlace": "Kampung Baru Tanjung Sepat, Morib & Tanjung Sepat, Selangor"
            }
          ]
        }
      ]
    },
    {
      "id": "selangor_kuala_selangor",
      "num": 7,
      "name": "Kuala Selangor",
      "state": "Selangor",
      "towns": [
        {
          "id": "selangor_kuala_selangor_bandar_puncak_alam",
          "name": "Bandar Puncak Alam",
          "fullName": "Bandar Puncak Alam (Mega Township Hub)",
          "queryPlace": "Bandar Puncak Alam, Kuala Selangor, Selangor",
          "tamans": [
            {
              "name": "Bandar Puncak Alam Central (Fasa 1, 2, 3)",
              "queryPlace": "Bandar Puncak Alam Central, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Graham Garden",
              "queryPlace": "Graham Garden, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Avenham Garden",
              "queryPlace": "Avenham Garden, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Norton Garden",
              "queryPlace": "Norton Garden, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Regent Garden",
              "queryPlace": "Regent Garden, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Grandeur Labs Commercial Hub",
              "queryPlace": "Grandeur Labs Commercial Hub, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Pine, Olive, Cherry, Maple, Meranti",
              "queryPlace": "Pine, Olive, Cherry, Maple, Meranti, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Forest Park & Lake Park",
              "queryPlace": "Forest Park & Lake Park, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Puncak Bestari & Puncak Bestari 2",
              "queryPlace": "Puncak Bestari & Puncak Bestari 2, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Saujana Perdana",
              "queryPlace": "Saujana Perdana, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Tropicana Alam",
              "queryPlace": "Tropicana Alam, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Dataran Suria",
              "queryPlace": "Dataran Suria, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Shah Alam 2 (Puncak Alam North)",
              "queryPlace": "Shah Alam 2, Bandar Puncak Alam, Selangor"
            },
            {
              "name": "Alam Suria",
              "queryPlace": "Alam Suria, Bandar Puncak Alam, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_selangor_saujana_utama_pristana",
          "name": "Saujana Utama & Pristana",
          "fullName": "Bandar Saujana Utama & Seri Pristana",
          "queryPlace": "Saujana Utama & Pristana, Kuala Selangor, Selangor",
          "tamans": [
            {
              "name": "Bandar Saujana Utama (Saujana Utama 1, 2, 3)",
              "queryPlace": "Bandar Saujana Utama, Saujana Utama & Pristana, Selangor"
            },
            {
              "name": "Sinar",
              "queryPlace": "Sinar, Saujana Utama & Pristana, Selangor"
            },
            {
              "name": "Sinar 2",
              "queryPlace": "Sinar 2, Saujana Utama & Pristana, Selangor"
            },
            {
              "name": "Sinar Warisan",
              "queryPlace": "Sinar Warisan, Saujana Utama & Pristana, Selangor"
            },
            {
              "name": "Seri Pristana (Pristana 1, 2, 3)",
              "queryPlace": "Seri Pristana, Saujana Utama & Pristana, Selangor"
            },
            {
              "name": "Taman Saujana Aman",
              "queryPlace": "Taman Saujana Aman, Saujana Utama & Pristana, Selangor"
            },
            {
              "name": "Sungai Buloh Country Resort (SBCR)",
              "queryPlace": "Sungai Buloh Country Resort, Saujana Utama & Pristana, Selangor"
            },
            {
              "name": "Saujana Utama Central Mart Commercial Strip",
              "queryPlace": "Saujana Utama Central Mart Commercial Strip, Saujana Utama & Pristana, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_selangor_kuala_selangor_town",
          "name": "Kuala Selangor Town",
          "fullName": "Kuala Selangor Town & Pasir Penambang",
          "queryPlace": "Kuala Selangor Town, Kuala Selangor, Selangor",
          "tamans": [
            {
              "name": "Pusat Bandar Kuala Selangor (Bandar Malawati)",
              "queryPlace": "Pusat Bandar Kuala Selangor, Kuala Selangor Town, Selangor"
            },
            {
              "name": "Bukit Malawati Historic Hill",
              "queryPlace": "Bukit Malawati Historic Hill, Kuala Selangor Town, Selangor"
            },
            {
              "name": "Taman Bendahara",
              "queryPlace": "Taman Bendahara, Kuala Selangor Town, Selangor"
            },
            {
              "name": "Taman Malawati Jaya",
              "queryPlace": "Taman Malawati Jaya, Kuala Selangor Town, Selangor"
            },
            {
              "name": "Taman Melati (Kuala Selangor)",
              "queryPlace": "Taman Melati, Kuala Selangor Town, Selangor"
            },
            {
              "name": "Taman Seri Penggawa",
              "queryPlace": "Taman Seri Penggawa, Kuala Selangor Town, Selangor"
            },
            {
              "name": "Taman Kuala Selangor Utama",
              "queryPlace": "Taman Kuala Selangor Utama, Kuala Selangor Town, Selangor"
            },
            {
              "name": "Taman Desiran Malawati",
              "queryPlace": "Taman Desiran Malawati, Kuala Selangor Town, Selangor"
            },
            {
              "name": "Taman Paduka",
              "queryPlace": "Taman Paduka, Kuala Selangor Town, Selangor"
            },
            {
              "name": "Taman Penambang",
              "queryPlace": "Taman Penambang, Kuala Selangor Town, Selangor"
            },
            {
              "name": "Taman Bagan Pasir",
              "queryPlace": "Taman Bagan Pasir, Kuala Selangor Town, Selangor"
            },
            {
              "name": "Seafood Commercial & Jetty Strip",
              "queryPlace": "Seafood Commercial & Jetty Strip, Kuala Selangor Town, Selangor"
            },
            {
              "name": "Kampung Kuantan & Bukit Belimbing (Firefly Sanctuaries)",
              "queryPlace": "Kampung Kuantan & Bukit Belimbing, Kuala Selangor Town, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_selangor_ijok_parit_mahang",
          "name": "Ijok & Parit Mahang",
          "fullName": "Ijok & Parit Mahang (MPKS)",
          "queryPlace": "Ijok & Parit Mahang, Kuala Selangor, Selangor",
          "tamans": [
            {
              "name": "Pekan Ijok",
              "queryPlace": "Pekan Ijok, Ijok & Parit Mahang, Selangor"
            },
            {
              "name": "Simpang Tiga Ijok",
              "queryPlace": "Simpang Tiga Ijok, Ijok & Parit Mahang, Selangor"
            },
            {
              "name": "Pekan Parit Mahang",
              "queryPlace": "Pekan Parit Mahang, Ijok & Parit Mahang, Selangor"
            },
            {
              "name": "Taman Sejati",
              "queryPlace": "Taman Sejati, Ijok & Parit Mahang, Selangor"
            },
            {
              "name": "Taman Ijok Indah",
              "queryPlace": "Taman Ijok Indah, Ijok & Parit Mahang, Selangor"
            },
            {
              "name": "Taman Ijok Utama",
              "queryPlace": "Taman Ijok Utama, Ijok & Parit Mahang, Selangor"
            },
            {
              "name": "Taman Harmoni (Ijok)",
              "queryPlace": "Taman Harmoni, Ijok & Parit Mahang, Selangor"
            },
            {
              "name": "Taman Koperasi Bena",
              "queryPlace": "Taman Koperasi Bena, Ijok & Parit Mahang, Selangor"
            },
            {
              "name": "Taman Kris",
              "queryPlace": "Taman Kris, Ijok & Parit Mahang, Selangor"
            },
            {
              "name": "Taman Seri Ijok",
              "queryPlace": "Taman Seri Ijok, Ijok & Parit Mahang, Selangor"
            },
            {
              "name": "Taman Ijok Damai",
              "queryPlace": "Taman Ijok Damai, Ijok & Parit Mahang, Selangor"
            },
            {
              "name": "Taman Simfoni Ijok",
              "queryPlace": "Taman Simfoni Ijok, Ijok & Parit Mahang, Selangor"
            },
            {
              "name": "Kampung Baru Ijok",
              "queryPlace": "Kampung Baru Ijok, Ijok & Parit Mahang, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_selangor_bukit_rotan",
          "name": "Bukit Rotan",
          "fullName": "Bukit Rotan (MPKS)",
          "queryPlace": "Bukit Rotan, Kuala Selangor, Selangor",
          "tamans": [
            {
              "name": "Pekan Bukit Rotan",
              "queryPlace": "Pekan Bukit Rotan, Bukit Rotan, Selangor"
            },
            {
              "name": "Taman Bukit Rotan",
              "queryPlace": "Taman Bukit Rotan, Bukit Rotan, Selangor"
            },
            {
              "name": "Bukit Rotan Estate Corridor",
              "queryPlace": "Bukit Rotan Estate Corridor, Bukit Rotan, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_selangor_bestari_jaya",
          "name": "Bestari Jaya",
          "fullName": "Bestari Jaya (Batang Berjuntai)",
          "queryPlace": "Bestari Jaya, Kuala Selangor, Selangor",
          "tamans": [
            {
              "name": "Pekan Bestari Jaya",
              "queryPlace": "Pekan Bestari Jaya, Bestari Jaya, Selangor"
            },
            {
              "name": "Taman Kilauan Bestari",
              "queryPlace": "Taman Kilauan Bestari, Bestari Jaya, Selangor"
            },
            {
              "name": "Taman Seri Bestari",
              "queryPlace": "Taman Seri Bestari, Bestari Jaya, Selangor"
            },
            {
              "name": "Taman Berjuntai Bestari",
              "queryPlace": "Taman Berjuntai Bestari, Bestari Jaya, Selangor"
            },
            {
              "name": "Taman Desa Bestari",
              "queryPlace": "Taman Desa Bestari, Bestari Jaya, Selangor"
            },
            {
              "name": "Universiti Selangor (UNISEL) Main Campus Corridor",
              "queryPlace": "Universiti Selangor Main Campus Corridor, Bestari Jaya, Selangor"
            },
            {
              "name": "Kampung Jaya",
              "queryPlace": "Kampung Jaya, Bestari Jaya, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_selangor_jeram_sasaran",
          "name": "Jeram & Sasaran",
          "fullName": "Jeram & Sasaran",
          "queryPlace": "Jeram & Sasaran, Kuala Selangor, Selangor",
          "tamans": [
            {
              "name": "Pekan Jeram",
              "queryPlace": "Pekan Jeram, Jeram & Sasaran, Selangor"
            },
            {
              "name": "Sungai Buloh Sasaran (Sasaran Art Village)",
              "queryPlace": "Sungai Buloh Sasaran, Jeram & Sasaran, Selangor"
            },
            {
              "name": "Taman Sasaran Indah",
              "queryPlace": "Taman Sasaran Indah, Jeram & Sasaran, Selangor"
            },
            {
              "name": "Taman Jeram Indah",
              "queryPlace": "Taman Jeram Indah, Jeram & Sasaran, Selangor"
            },
            {
              "name": "Taman Jeram Maju",
              "queryPlace": "Taman Jeram Maju, Jeram & Sasaran, Selangor"
            },
            {
              "name": "Taman Seri Jeram",
              "queryPlace": "Taman Seri Jeram, Jeram & Sasaran, Selangor"
            },
            {
              "name": "Taman Remis Indah",
              "queryPlace": "Taman Remis Indah, Jeram & Sasaran, Selangor"
            },
            {
              "name": "Pantai Remis & Pantai Jeram",
              "queryPlace": "Pantai Remis & Pantai Jeram, Jeram & Sasaran, Selangor"
            },
            {
              "name": "Kampung Sungai Sembilang",
              "queryPlace": "Kampung Sungai Sembilang, Jeram & Sasaran, Selangor"
            }
          ]
        },
        {
          "id": "selangor_kuala_selangor_tanjung_karang",
          "name": "Tanjung Karang",
          "fullName": "Tanjung Karang (MPKS)",
          "queryPlace": "Tanjung Karang, Kuala Selangor, Selangor",
          "tamans": [
            {
              "name": "Pekan Tanjung Karang",
              "queryPlace": "Pekan Tanjung Karang, Tanjung Karang, Selangor"
            },
            {
              "name": "Taman Tanjung Karang Baru",
              "queryPlace": "Taman Tanjung Karang Baru, Tanjung Karang, Selangor"
            },
            {
              "name": "Taman Sungai Yu Indah",
              "queryPlace": "Taman Sungai Yu Indah, Tanjung Karang, Selangor"
            },
            {
              "name": "Taman Mashuri Indah",
              "queryPlace": "Taman Mashuri Indah, Tanjung Karang, Selangor"
            },
            {
              "name": "Taman Radin Mas",
              "queryPlace": "Taman Radin Mas, Tanjung Karang, Selangor"
            },
            {
              "name": "Taman Seri Tanjung",
              "queryPlace": "Taman Seri Tanjung, Tanjung Karang, Selangor"
            },
            {
              "name": "Taman Desa Ria",
              "queryPlace": "Taman Desa Ria, Tanjung Karang, Selangor"
            },
            {
              "name": "Sungai Sireh (Agrotourism & Homestays)",
              "queryPlace": "Sungai Sireh, Tanjung Karang, Selangor"
            },
            {
              "name": "Bagan Pasir Tanjung Karang",
              "queryPlace": "Bagan Pasir Tanjung Karang, Tanjung Karang, Selangor"
            },
            {
              "name": "Ban Canal & Sungai Tengi Paddy Settlements",
              "queryPlace": "Ban Canal & Sungai Tengi Paddy Settlements, Tanjung Karang, Selangor"
            }
          ]
        }
      ]
    },
    {
      "id": "selangor_hulu_selangor",
      "num": 8,
      "name": "Hulu Selangor",
      "state": "Selangor",
      "towns": [
        {
          "id": "selangor_hulu_selangor_bukit_beruntung_sentosa",
          "name": "Bukit Beruntung & Sentosa",
          "fullName": "Bukit Beruntung & Bukit Sentosa (MPHS)",
          "queryPlace": "Bukit Beruntung & Sentosa, Hulu Selangor, Selangor",
          "tamans": [
            {
              "name": "Bukit Beruntung Golf & Country Resort Zone",
              "queryPlace": "Bukit Beruntung Golf & Country Resort Zone, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Taman Bunga Raya (Apartment Dahlia, Teratai, Kemboja)",
              "queryPlace": "Taman Bunga Raya, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Taman Melati",
              "queryPlace": "Taman Melati, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Taman Anggerik",
              "queryPlace": "Taman Anggerik, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Prima Beruntung",
              "queryPlace": "Prima Beruntung, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Kawasan Perindustrian Bukit Beruntung",
              "queryPlace": "Kawasan Perindustrian Bukit Beruntung, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Bukit Sentosa 1 (BS 1)",
              "queryPlace": "Bukit Sentosa 1, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Bukit Sentosa 2 (BS 2)",
              "queryPlace": "Bukit Sentosa 2, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Bukit Sentosa 3 (BS 3)",
              "queryPlace": "Bukit Sentosa 3, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Taman Saffron",
              "queryPlace": "Taman Saffron, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Taman Kemboja",
              "queryPlace": "Taman Kemboja, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Taman Teluki",
              "queryPlace": "Taman Teluki, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Taman Jejarum",
              "queryPlace": "Taman Jejarum, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Taman Adenium",
              "queryPlace": "Taman Adenium, Bukit Beruntung & Sentosa, Selangor"
            },
            {
              "name": "Grand Union Industrial Park",
              "queryPlace": "Grand Union Industrial Park, Bukit Beruntung & Sentosa, Selangor"
            }
          ]
        },
        {
          "id": "selangor_hulu_selangor_batang_kali",
          "name": "Batang Kali",
          "fullName": "Batang Kali & Genting Foothills (MPHS)",
          "queryPlace": "Batang Kali, Hulu Selangor, Selangor",
          "tamans": [
            {
              "name": "Ligamas Heights",
              "queryPlace": "Ligamas Heights, Batang Kali, Selangor"
            },
            {
              "name": "Ligamas Street Mall",
              "queryPlace": "Ligamas Street Mall, Batang Kali, Selangor"
            },
            {
              "name": "Taman Bayan",
              "queryPlace": "Taman Bayan, Batang Kali, Selangor"
            },
            {
              "name": "Tamu Hill Park",
              "queryPlace": "Tamu Hill Park, Batang Kali, Selangor"
            },
            {
              "name": "Taman Seri Cahaya",
              "queryPlace": "Taman Seri Cahaya, Batang Kali, Selangor"
            },
            {
              "name": "Taman Semarak",
              "queryPlace": "Taman Semarak, Batang Kali, Selangor"
            },
            {
              "name": "Taman Sri Batang Kali",
              "queryPlace": "Taman Sri Batang Kali, Batang Kali, Selangor"
            },
            {
              "name": "Taman Rasa Indah",
              "queryPlace": "Taman Rasa Indah, Batang Kali, Selangor"
            },
            {
              "name": "Genting Valley (Batang Kali)",
              "queryPlace": "Genting Valley, Batang Kali, Selangor"
            },
            {
              "name": "Kampung Baru Batang Kali",
              "queryPlace": "Kampung Baru Batang Kali, Batang Kali, Selangor"
            },
            {
              "name": "Kampung Bukit Chandang",
              "queryPlace": "Kampung Bukit Chandang, Batang Kali, Selangor"
            },
            {
              "name": "Genting Highlands Foothill Corridor",
              "queryPlace": "Genting Highlands Foothill Corridor, Batang Kali, Selangor"
            }
          ]
        },
        {
          "id": "selangor_hulu_selangor_serendah_sungai_choh",
          "name": "Serendah & Sungai Choh",
          "fullName": "Serendah, Antara Gapi & Sungai Choh (MPHS)",
          "queryPlace": "Serendah & Sungai Choh, Hulu Selangor, Selangor",
          "tamans": [
            {
              "name": "Antara Gapi (Seksyen 1 to Seksyen 6)",
              "queryPlace": "Antara Gapi, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Pekan Serendah",
              "queryPlace": "Pekan Serendah, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Taman Serendah Makmur",
              "queryPlace": "Taman Serendah Makmur, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Taman Idaman",
              "queryPlace": "Taman Idaman, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Taman Seri Serendah",
              "queryPlace": "Taman Seri Serendah, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Taman Tasik Teratai",
              "queryPlace": "Taman Tasik Teratai, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Desa Melor",
              "queryPlace": "Desa Melor, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Taman Bukit Cahaya (Cempaka)",
              "queryPlace": "Taman Bukit Cahaya, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Serendah Golf Resort",
              "queryPlace": "Serendah Golf Resort, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Taman Melati Serendah",
              "queryPlace": "Taman Melati Serendah, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Perigi Tujuh Serendah Enclave",
              "queryPlace": "Perigi Tujuh Serendah Enclave, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Kampung Baru Serendah",
              "queryPlace": "Kampung Baru Serendah, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Pekan Sungai Choh",
              "queryPlace": "Pekan Sungai Choh, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Taman Sungai Choh",
              "queryPlace": "Taman Sungai Choh, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Taman Bukit Teratai",
              "queryPlace": "Taman Bukit Teratai, Serendah & Sungai Choh, Selangor"
            },
            {
              "name": "Kawasan Perindustrian Sungai Choh (Perodua Manufacturing Headquarters)",
              "queryPlace": "Kawasan Perindustrian Sungai Choh, Serendah & Sungai Choh, Selangor"
            }
          ]
        },
        {
          "id": "selangor_hulu_selangor_kuala_kubu_bharu_rasa",
          "name": "Kuala Kubu Bharu & Rasa",
          "fullName": "Kuala Kubu Bharu (District Capital), Rasa & The Gap",
          "queryPlace": "Kuala Kubu Bharu & Rasa, Hulu Selangor, Selangor",
          "tamans": [
            {
              "name": "Ampang Pechah",
              "queryPlace": "Ampang Pechah, Kuala Kubu Bharu & Rasa, Selangor"
            },
            {
              "name": "Taman Pinggiran KKB",
              "queryPlace": "Taman Pinggiran KKB, Kuala Kubu Bharu & Rasa, Selangor"
            },
            {
              "name": "Taman Tanjak",
              "queryPlace": "Taman Tanjak, Kuala Kubu Bharu & Rasa, Selangor"
            },
            {
              "name": "Taman Damai Utama",
              "queryPlace": "Taman Damai Utama, Kuala Kubu Bharu & Rasa, Selangor"
            },
            {
              "name": "Taman Bukit KKB",
              "queryPlace": "Taman Bukit KKB, Kuala Kubu Bharu & Rasa, Selangor"
            },
            {
              "name": "Taman Seri KKB",
              "queryPlace": "Taman Seri KKB, Kuala Kubu Bharu & Rasa, Selangor"
            },
            {
              "name": "Alor Lempah",
              "queryPlace": "Alor Lempah, Kuala Kubu Bharu & Rasa, Selangor"
            },
            {
              "name": "The Gap / Fraser's Hill (Bukit Fraser - Selangor section)",
              "queryPlace": "The Gap / Fraser's Hill, Kuala Kubu Bharu & Rasa, Selangor"
            },
            {
              "name": "Taman Rasa Permai",
              "queryPlace": "Taman Rasa Permai, Kuala Kubu Bharu & Rasa, Selangor"
            },
            {
              "name": "Taman Rasa Jaya",
              "queryPlace": "Taman Rasa Jaya, Kuala Kubu Bharu & Rasa, Selangor"
            },
            {
              "name": "Taman Chuan",
              "queryPlace": "Taman Chuan, Kuala Kubu Bharu & Rasa, Selangor"
            },
            {
              "name": "Kampung Baru Rasa",
              "queryPlace": "Kampung Baru Rasa, Kuala Kubu Bharu & Rasa, Selangor"
            }
          ]
        },
        {
          "id": "selangor_hulu_selangor_hulu_yam",
          "name": "Hulu Yam",
          "fullName": "Hulu Yam (MPHS)",
          "queryPlace": "Hulu Yam, Hulu Selangor, Selangor",
          "tamans": [
            {
              "name": "Hulu Yam Bharu",
              "queryPlace": "Hulu Yam Bharu, Hulu Yam, Selangor"
            },
            {
              "name": "Hulu Yam Lama",
              "queryPlace": "Hulu Yam Lama, Hulu Yam, Selangor"
            },
            {
              "name": "Taman Desa Kaloi",
              "queryPlace": "Taman Desa Kaloi, Hulu Yam, Selangor"
            },
            {
              "name": "Taman Gembira (Hulu Yam)",
              "queryPlace": "Taman Gembira, Hulu Yam, Selangor"
            },
            {
              "name": "Taman Kelah",
              "queryPlace": "Taman Kelah, Hulu Yam, Selangor"
            },
            {
              "name": "Kampung Baru Hulu Yam",
              "queryPlace": "Kampung Baru Hulu Yam, Hulu Yam, Selangor"
            }
          ]
        },
        {
          "id": "selangor_hulu_selangor_kerling_kalumpang_sungai_buaya",
          "name": "Kerling, Kalumpang & Sungai Buaya",
          "fullName": "Kerling, Kalumpang, Hulu Bernam & Sungai Buaya",
          "queryPlace": "Kerling, Kalumpang & Sungai Buaya, Hulu Selangor, Selangor",
          "tamans": [
            {
              "name": "Pekan Kerling & Taman Kerling Damai",
              "queryPlace": "Pekan Kerling & Taman Kerling Damai, Kerling, Kalumpang & Sungai Buaya, Selangor"
            },
            {
              "name": "Pekan Kalumpang & Taman Kalumpang Indah",
              "queryPlace": "Pekan Kalumpang & Taman Kalumpang Indah, Kerling, Kalumpang & Sungai Buaya, Selangor"
            },
            {
              "name": "Bernam Jaya (Hulu Bernam - Selangor/Perak Border)",
              "queryPlace": "Bernam Jaya, Kerling, Kalumpang & Sungai Buaya, Selangor"
            },
            {
              "name": "Lembah Bernam",
              "queryPlace": "Lembah Bernam, Kerling, Kalumpang & Sungai Buaya, Selangor"
            },
            {
              "name": "Kawasan Perumahan Sungai Buaya",
              "queryPlace": "Kawasan Perumahan Sungai Buaya, Kerling, Kalumpang & Sungai Buaya, Selangor"
            },
            {
              "name": "Taman Desa Melati",
              "queryPlace": "Taman Desa Melati, Kerling, Kalumpang & Sungai Buaya, Selangor"
            },
            {
              "name": "Taman Murai",
              "queryPlace": "Taman Murai, Kerling, Kalumpang & Sungai Buaya, Selangor"
            }
          ]
        }
      ]
    },
    {
      "id": "selangor_sabak_bernam",
      "num": 9,
      "name": "Sabak Bernam",
      "state": "Selangor",
      "towns": [
        {
          "id": "selangor_sabak_bernam_sabak_bernam_town",
          "name": "Sabak Bernam Town",
          "fullName": "Sabak Bernam Town & Environs (MDSB)",
          "queryPlace": "Sabak Bernam Town, Sabak Bernam, Selangor",
          "tamans": [
            {
              "name": "Pusat Bandar Sabak Bernam",
              "queryPlace": "Pusat Bandar Sabak Bernam, Sabak Bernam Town, Selangor"
            },
            {
              "name": "Taman Kenanga",
              "queryPlace": "Taman Kenanga, Sabak Bernam Town, Selangor"
            },
            {
              "name": "Taman Teratai",
              "queryPlace": "Taman Teratai, Sabak Bernam Town, Selangor"
            },
            {
              "name": "Taman Muhibbah (Sabak Bernam)",
              "queryPlace": "Taman Muhibbah, Sabak Bernam Town, Selangor"
            },
            {
              "name": "Taman Bernam Jaya",
              "queryPlace": "Taman Bernam Jaya, Sabak Bernam Town, Selangor"
            },
            {
              "name": "Taman Pertama",
              "queryPlace": "Taman Pertama, Sabak Bernam Town, Selangor"
            },
            {
              "name": "Taman Air Manis",
              "queryPlace": "Taman Air Manis, Sabak Bernam Town, Selangor"
            },
            {
              "name": "Taman Budi 2",
              "queryPlace": "Taman Budi 2, Sabak Bernam Town, Selangor"
            },
            {
              "name": "Taman Serendah (Sabak)",
              "queryPlace": "Taman Serendah, Sabak Bernam Town, Selangor"
            },
            {
              "name": "Taman Murni",
              "queryPlace": "Taman Murni, Sabak Bernam Town, Selangor"
            },
            {
              "name": "Taman Ria Sabak",
              "queryPlace": "Taman Ria Sabak, Sabak Bernam Town, Selangor"
            },
            {
              "name": "Taman Berkat",
              "queryPlace": "Taman Berkat, Sabak Bernam Town, Selangor"
            },
            {
              "name": "Tebuk Pulai",
              "queryPlace": "Tebuk Pulai, Sabak Bernam Town, Selangor"
            }
          ]
        },
        {
          "id": "selangor_sabak_bernam_sungai_besar",
          "name": "Sungai Besar",
          "fullName": "Sungai Besar (District Administrative Center)",
          "queryPlace": "Sungai Besar, Sabak Bernam, Selangor",
          "tamans": [
            {
              "name": "Pusat Bandar Sungai Besar",
              "queryPlace": "Pusat Bandar Sungai Besar, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Padu Permai",
              "queryPlace": "Taman Padu Permai, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Bedena & Taman Bedena Jaya",
              "queryPlace": "Taman Bedena & Taman Bedena Jaya, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Gelama",
              "queryPlace": "Taman Gelama, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Perdana",
              "queryPlace": "Taman Perdana, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Arowarna Perdana",
              "queryPlace": "Taman Arowarna Perdana, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Yu",
              "queryPlace": "Taman Yu, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Cahaya",
              "queryPlace": "Taman Cahaya, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Ehsan & Taman Ehsan Ria",
              "queryPlace": "Taman Ehsan & Taman Ehsan Ria, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Makmur",
              "queryPlace": "Taman Makmur, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Ria",
              "queryPlace": "Taman Ria, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Seri & Taman Seri 2",
              "queryPlace": "Taman Seri & Taman Seri 2, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Seri Bedena",
              "queryPlace": "Taman Seri Bedena, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Sri Indah",
              "queryPlace": "Taman Sri Indah, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Suria (Sungai Besar)",
              "queryPlace": "Taman Suria, Sungai Besar, Selangor"
            },
            {
              "name": "Taman Dorani Sejahtera",
              "queryPlace": "Taman Dorani Sejahtera, Sungai Besar, Selangor"
            },
            {
              "name": "Parit 1 to Parit 16 Sungai Besar",
              "queryPlace": "Parit 1 to Parit 16 Sungai Besar, Sungai Besar, Selangor"
            },
            {
              "name": "Pekan Sungai Limau",
              "queryPlace": "Pekan Sungai Limau, Sungai Besar, Selangor"
            }
          ]
        },
        {
          "id": "selangor_sabak_bernam_sekinchan",
          "name": "Sekinchan",
          "fullName": "Sekinchan (Agrotourism & Paddy Field Hub)",
          "queryPlace": "Sekinchan, Sabak Bernam, Selangor",
          "tamans": [
            {
              "name": "Pekan Sekinchan",
              "queryPlace": "Pekan Sekinchan, Sekinchan, Selangor"
            },
            {
              "name": "Taman Aman & Taman Aman Utama",
              "queryPlace": "Taman Aman & Taman Aman Utama, Sekinchan, Selangor"
            },
            {
              "name": "Taman Sekinchan Damai (One Residence)",
              "queryPlace": "Taman Sekinchan Damai, Sekinchan, Selangor"
            },
            {
              "name": "Taman Ria Jaya",
              "queryPlace": "Taman Ria Jaya, Sekinchan, Selangor"
            },
            {
              "name": "Taman Indah 2",
              "queryPlace": "Taman Indah 2, Sekinchan, Selangor"
            },
            {
              "name": "Taman Sekinchan Jaya",
              "queryPlace": "Taman Sekinchan Jaya, Sekinchan, Selangor"
            },
            {
              "name": "Taman Sri Sekinchan",
              "queryPlace": "Taman Sri Sekinchan, Sekinchan, Selangor"
            },
            {
              "name": "Kampung Baru Site A (Paddy Field Tourism Hub)",
              "queryPlace": "Kampung Baru Site A, Sekinchan, Selangor"
            },
            {
              "name": "Kampung Baru Site B (Commercial & Residential)",
              "queryPlace": "Kampung Baru Site B, Sekinchan, Selangor"
            },
            {
              "name": "Kampung Baru Site C",
              "queryPlace": "Kampung Baru Site C, Sekinchan, Selangor"
            },
            {
              "name": "Bagan Sekinchan (Coastal Seafood & Fishing Settlement)",
              "queryPlace": "Bagan Sekinchan, Sekinchan, Selangor"
            },
            {
              "name": "Pantai Redang Sekinchan",
              "queryPlace": "Pantai Redang Sekinchan, Sekinchan, Selangor"
            }
          ]
        },
        {
          "id": "selangor_sabak_bernam_sungai_air_tawar_bagan_nakhoda_omar",
          "name": "Sungai Air Tawar & Bagan Nakhoda Omar",
          "fullName": "Sungai Air Tawar, Pasir Panjang & Bagan Nakhoda Omar",
          "queryPlace": "Sungai Air Tawar & Bagan Nakhoda Omar, Sabak Bernam, Selangor",
          "tamans": [
            {
              "name": "Taman Air Tawar",
              "queryPlace": "Taman Air Tawar, Sungai Air Tawar & Bagan Nakhoda Omar, Selangor"
            },
            {
              "name": "Taman Ria Air Tawar",
              "queryPlace": "Taman Ria Air Tawar, Sungai Air Tawar & Bagan Nakhoda Omar, Selangor"
            },
            {
              "name": "Bagan Nakhoda Omar (BNO Beach & Waterfront)",
              "queryPlace": "Bagan Nakhoda Omar, Sungai Air Tawar & Bagan Nakhoda Omar, Selangor"
            },
            {
              "name": "Parit Baru",
              "queryPlace": "Parit Baru, Sungai Air Tawar & Bagan Nakhoda Omar, Selangor"
            },
            {
              "name": "Sungai Nibong",
              "queryPlace": "Sungai Nibong, Sungai Air Tawar & Bagan Nakhoda Omar, Selangor"
            },
            {
              "name": "Taman Pasir Panjang Indah",
              "queryPlace": "Taman Pasir Panjang Indah, Sungai Air Tawar & Bagan Nakhoda Omar, Selangor"
            }
          ]
        }
      ]
    }
  ]
};

export const ALL_TERRITORIES: Record<string, StateTerritory> = {
  selangor: SELANGOR_TERRITORY,
  johor: JOHOR_TERRITORY,
};

/** A taman taman-finder.ts found and checked on Google Maps. */
export interface DiscoveredTamanInput {
  state: string;
  district: string;
  name: string;
  query_place: string;
  verified: boolean;
}

/**
 * A copy of the state's districts with its verified discovered tamans added,
 * each district's under one extra town, "Newly found tamans". Unverified ones
 * stay out: a name only a search snippet gave is not yet a place.
 */
export function withDiscovered(base: StateTerritory, discovered: DiscoveredTamanInput[] = []): DistrictLocation[] {
  const districts: DistrictLocation[] = JSON.parse(JSON.stringify(base.districts));
  for (const d of districts) {
    const known = new Set(d.towns.flatMap((t) => t.tamans.map((tm) => cleanStr(tm.queryPlace))));
    const found = discovered.filter((x) => x.verified
      && cleanStr(x.state) === cleanStr(base.state) && cleanStr(x.district) === cleanStr(d.name)
      && !known.has(cleanStr(x.query_place)));
    if (!found.length) continue;
    d.towns.push({
      id: d.id + '_discovered',
      name: 'Newly found tamans',
      fullName: 'Newly found tamans (' + d.name + ')',
      queryPlace: d.name + ', ' + base.state,
      tamans: found.map((x) => ({ name: x.name, queryPlace: x.query_place })),
    });
  }
  return districts;
}

/** Every taman of every listed state, in list order: what the taman auto-scan walks. */
export function allTamans(discovered: DiscoveredTamanInput[] = [], states = Object.keys(ALL_TERRITORIES)): Array<{
  state: string; district: string; town: string; name: string; queryPlace: string;
}> {
  const out: Array<{ state: string; district: string; town: string; name: string; queryPlace: string }> = [];
  for (const key of states) {
    const base = ALL_TERRITORIES[key.toLowerCase()];
    if (!base) continue;
    for (const d of withDiscovered(base, discovered)) {
      for (const t of d.towns) for (const tm of t.tamans) out.push({ state: base.state, district: d.name, town: t.name, name: tm.name, queryPlace: tm.queryPlace });
    }
  }
  return out;
}

function cleanStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export interface TerritoryScanStatInput {
  public_id: string;
  status: string;
  place: string;
  keyword: string | null;
  company_count: number;
  contact_count?: number | null;
  created_at: string;
  assigned_to?: string | null;
}

function pickBestScan(matches: TerritoryScanStatInput[]): TerritoryScanStatInput | undefined {
  if (!matches.length) return undefined;
  const active = matches.find((s) => s.status === 'running' || s.status === 'queued');
  if (active) return active;
  const completed = matches.find((s) => s.status === 'completed');
  if (completed) return completed;
  const partialWithResults = matches.find((s) => s.status === 'partial' && s.company_count > 0);
  if (partialWithResults) return partialWithResults;
  return matches[0];
}

function hasUsableScan(scan: TerritoryScanStatInput): boolean {
  return scan.status === 'completed' || (scan.status === 'partial' && scan.company_count > 0);
}

function scanKeywordKey(keyword: string | null): string {
  return (keyword ?? '').trim().toLowerCase();
}

function toScanBadge(scan: TerritoryScanStatInput): ScanBadgeInfo {
  return {
    publicId: scan.public_id,
    status: scan.status,
    count: scan.company_count,
    contacts: Number(scan.contact_count) || 0,
    createdAt: scan.created_at,
    keyword: scan.keyword,
    assignedTo: scan.assigned_to || null,
  };
}

export function buildTerritoryResponse(
  stateName = 'johor',
  scans: TerritoryScanStatInput[] = [],
  tamanAssignments: Record<string, { assigned_to: string; telemarketer_uid?: string | null; assigned_at?: string } | string> = {},
  contactPending: Record<string, number> = {},
  discovered: DiscoveredTamanInput[] = [],
) {
  const base = ALL_TERRITORIES[stateName.toLowerCase()] ?? JOHOR_TERRITORY;
  const districts: DistrictLocation[] = withDiscovered(base, discovered);

  let totalTamans = 0;
  let scannedTamans = 0;
  let totalLeads = 0;
  let totalContacts = 0;
  let totalTowns = 0;
  const uniqueScanIds = new Set<string>();

  for (const d of districts) {
    let dTamans = 0;
    let dScanned = 0;
    totalTowns += d.towns.length;

    for (const t of d.towns) {
      const townQueryNorm = cleanStr(t.queryPlace);
      const townNameNorm = cleanStr(t.name);

      const townMatches = scans.filter((s) => {
        const p = cleanStr(s.place);
        return p === townQueryNorm || p === townNameNorm || p.startsWith(townNameNorm + ' ' + base.state.toLowerCase());
      });
      const matchingTownScan = pickBestScan(townMatches);

      if (matchingTownScan) {
        t.scan = {
          publicId: matchingTownScan.public_id,
          status: matchingTownScan.status,
          count: matchingTownScan.company_count,
          contacts: Number(matchingTownScan.contact_count) || 0,
          createdAt: matchingTownScan.created_at,
          keyword: matchingTownScan.keyword,
        };
      }

      for (const tm of t.tamans) {
        dTamans++;
        totalTamans++;
        const tamanQueryNorm = cleanStr(tm.queryPlace);
        const tamanNameNorm = cleanStr(tm.name.replace(/^(taman|jalan|bandar|desa|kampung)\s+/i, ''));

        const tamanMatches = scans.filter((s) => {
          const p = cleanStr(s.place);
          if (p === tamanQueryNorm) return true;
          if (tamanNameNorm.length >= 3 && tamanNameNorm !== townNameNorm && p.includes(tamanNameNorm) && p.includes(townNameNorm)) return true;
          return false;
        });
        const matchingTamanScan = pickBestScan(tamanMatches);

        const matchesByKeyword = new Map<string, TerritoryScanStatInput[]>();
        for (const s of tamanMatches) {
          const key = scanKeywordKey(s.keyword);
          matchesByKeyword.set(key, [...(matchesByKeyword.get(key) ?? []), s]);
        }
        if (matchesByKeyword.size) {
          tm.scanByKeyword = Object.fromEntries(
            [...matchesByKeyword].map(([key, group]) => [key, toScanBadge(pickBestScan(group)!)]),
          );
        }

        if (matchingTamanScan) {
          tm.scan = toScanBadge(matchingTamanScan);
          if (hasUsableScan(matchingTamanScan)) {
            dScanned++;
            scannedTamans++;
            if (!uniqueScanIds.has(matchingTamanScan.public_id)) {
              uniqueScanIds.add(matchingTamanScan.public_id);
              totalLeads += matchingTamanScan.company_count || 0;
              totalContacts += Number(matchingTamanScan.contact_count) || 0;
            }
          }
        }

        tm.contactPending = contactPending[tm.queryPlace.trim().toLowerCase()] ?? 0;
        const rawAssignment = tamanAssignments[tm.name]
          || tamanAssignments[cleanStr(tm.name)]
          || (tamanQueryNorm ? tamanAssignments[tamanQueryNorm] : undefined);
        const assignedName = typeof rawAssignment === 'string'
          ? rawAssignment
          : (rawAssignment?.assigned_to || matchingTamanScan?.assigned_to || null);

        if (assignedName) {
          tm.assignedTo = assignedName;
          if (tm.scan) {
            tm.scan.assignedTo = assignedName;
          }
        }
      }
    }
    d.totalTamans = dTamans;
    d.scannedTamans = dScanned;
  }

  return {
    state: base.state,
    stats: {
      totalDistricts: districts.length,
      totalTowns,
      totalTamans,
      scannedTamans,
      totalLeads,
      totalContacts,
    },
    districts,
  };
}
