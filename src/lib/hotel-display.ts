import { HotelRecord } from "@/types";

/* ── Main hero images ── */
const hotelImages: Record<string, string> = {
	"110f01b8ae518a0ee41047bce5c22572988a435e10ead72dc1af793bba8ce0b0": "https://images.unsplash.com/photo-1522798514-97ceb8c4f1c8?w=800&q=80",
	"db38b19b897dbece3e34919c662b3fd66d23b615395d11fb69264dd3a9b17723": "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80",
	"5f5a0cd8662f0ddf297f2d27358f680daab5d3ac22fd45a4e1c3c3ec2c101a12": "https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=800&q=80",
	"3b984f3ba8df55b2609a1e33fd694cf8407842e1d833c9b4d993b07fc83a2820": "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800&q=80",
	"9a0043fd4258a1286db1e253ca591662b3aac849da12d0d4f67e08b8f59be65f": "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80",
	"e52d67a758ce4ad0229aacc97e5dfe89984c384c51a70208f9e0cc65c9cd4676": "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&q=80",
	"ff26cdda236b233f7c481f0e896814075ac6bed335e162e0ff01d5491343f838": "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80",
	"fa014137b3ea9af6a90c0a86a1d099e46f7e56d6eb33db1ad1ec4bdac68c3caa": "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80",
	"823fb2499b4e37d99acb65e7198e75965d6496fd1c579f976205c0e6179206df": "https://images.unsplash.com/photo-1555992336-03a23c7b20ee?w=800&q=80",
};

/* ── Gallery thumbnails (4 per hotel) ── */
const hotelGallery: Record<string, string[]> = {
	"110f01b8ae518a0ee41047bce5c22572988a435e10ead72dc1af793bba8ce0b0": [
		"https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=400&q=80",
		"https://images.unsplash.com/photo-1590490360182-c33d57733427?w=400&q=80",
		"https://images.unsplash.com/photo-1584132967334-10e028bd69f7?w=400&q=80",
		"https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=400&q=80",
	],
	"db38b19b897dbece3e34919c662b3fd66d23b615395d11fb69264dd3a9b17723": [
		"https://images.unsplash.com/photo-1590490360182-c33d57733427?w=400&q=80",
		"https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=400&q=80",
		"https://images.unsplash.com/photo-1584132915807-fd1f5fbc078f?w=400&q=80",
		"https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=400&q=80",
	],
};

const fallbackGallery = [
	"https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=400&q=80",
	"https://images.unsplash.com/photo-1590490360182-c33d57733427?w=400&q=80",
	"https://images.unsplash.com/photo-1584132967334-10e028bd69f7?w=400&q=80",
	"https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=400&q=80",
];

const fallbackImage = "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=800&q=80";

export function getHotelImage(hotel: HotelRecord): string {
	return hotelImages[hotel.id] ?? fallbackImage;
}

export function getHotelGallery(hotel: HotelRecord): string[] {
	return hotelGallery[hotel.id] ?? fallbackGallery;
}

/* ── Amenity icon mapping ── */
const amenityIcons: Record<string, string> = {
	"ac": "❄️",
	"bar": "🍸",
	"breakfast_included": "🥐",
	"breakfast_available": "🥐",
	"business_services": "💼",
	"crib": "👶",
	"elevator": "🛗",
	"fitness_equipment": "💪",
	"free_parking": "🅿️",
	"frontdesk_24_hour": "🔑",
	"grocery": "🛒",
	"heater": "🔥",
	"hot_tub": "♨️",
	"housekeeping": "🧹",
	"internet": "📶",
	"laundry": "👔",
	"microwave": "🍽️",
	"no_smoking": "🚭",
	"outdoor_space": "🌿",
	"pool": "🏊",
	"restaurant": "🍴",
	"room_service": "🛎️",
	"soundproof_room": "🔇",
	"spa": "💆",
	"tv": "📺",
	"toys": "🧸",
	"balcony": "🌅",
	"barbecue": "🔥",
};

export function getAmenityIcon(amenity: string): string {
	return amenityIcons[amenity.toLowerCase().replace(/\s+/g, "_")] ?? "✓";
}

/** Generate a rating label from numeric score */
export function ratingLabel(rating: number | null): string {
	if (rating === null) return "Not rated";
	if (rating >= 9.0) return "Wonderful";
	if (rating >= 8.0) return "Very Good";
	if (rating >= 7.0) return "Good";
	if (rating >= 6.0) return "Pleasant";
	return "Fair";
}

export function hotelSubtitle(hotel: HotelRecord) {
	return [hotel.city, hotel.province, hotel.country].filter(Boolean).join(", ");
}

export function initials(hotel: HotelRecord) {
	const left = hotel.city?.[0] ?? hotel.name?.[0] ?? "H";
	const right = hotel.country?.[0] ?? hotel.name?.[1] ?? "T";
	return `${left}${right}`.toUpperCase();
}

export function hotelGradient(index: number) {
	const gradients = [
		"from-sky-500 via-cyan-400 to-blue-600",
		"from-amber-400 via-orange-400 to-pink-500",
		"from-emerald-400 via-teal-400 to-cyan-500",
		"from-violet-500 via-fuchsia-400 to-rose-400",
		"from-blue-700 via-indigo-600 to-sky-500",
	];

	return gradients[index % gradients.length];
}
