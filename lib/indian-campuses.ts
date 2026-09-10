export type CampusRecord = {
  id: string;
  name: string;
  city: string;
  state: string;
  type: string;
  aliases?: string[];
};

export const starterIndianCampuses: CampusRecord[] = [
  { id: "TN-U-SRM-KTR", name: "SRM Institute of Science and Technology — Kattankulathur", city: "Chengalpattu", state: "Tamil Nadu", type: "Deemed University", aliases: ["SRM University", "SRM KTR", "SRM Chennai"] },
  { id: "TN-U-SRM-RMP", name: "SRM Institute of Science and Technology — Ramapuram", city: "Chennai", state: "Tamil Nadu", type: "Deemed University", aliases: ["SRM University Ramapuram", "SRM Chennai"] },
  { id: "TN-U-SRM-VDP", name: "SRM Institute of Science and Technology — Vadapalani", city: "Chennai", state: "Tamil Nadu", type: "Deemed University", aliases: ["SRM University Vadapalani", "SRM Chennai"] },
  { id: "TN-U-VIT-CHE", name: "Vellore Institute of Technology — Chennai", city: "Chennai", state: "Tamil Nadu", type: "Deemed University", aliases: ["VIT Chennai", "VIT University Chennai"] },
  { id: "TN-U-VIT-VEL", name: "Vellore Institute of Technology — Vellore", city: "Vellore", state: "Tamil Nadu", type: "Deemed University", aliases: ["VIT Vellore", "VIT University"] },
  { id: "AP-U-VIT", name: "VIT-AP University", city: "Amaravati", state: "Andhra Pradesh", type: "Private University", aliases: ["VIT AP"] },
  { id: "MP-U-VIT", name: "VIT Bhopal University", city: "Bhopal", state: "Madhya Pradesh", type: "Private University", aliases: ["VIT Bhopal"] },
  { id: "TN-U-ANNA", name: "Anna University", city: "Chennai", state: "Tamil Nadu", type: "State Public University" },
  { id: "TN-U-IITM", name: "Indian Institute of Technology Madras", city: "Chennai", state: "Tamil Nadu", type: "Institute of National Importance", aliases: ["IIT Madras", "IIT Chennai"] },
  { id: "KA-U-IISC", name: "Indian Institute of Science", city: "Bengaluru", state: "Karnataka", type: "Deemed University", aliases: ["IISc Bangalore", "IISc Bengaluru"] },
  { id: "KA-U-IIMB", name: "Indian Institute of Management Bangalore", city: "Bengaluru", state: "Karnataka", type: "Institute of National Importance", aliases: ["IIM Bangalore", "IIM Bengaluru"] },
  { id: "KA-U-MANIPAL", name: "Manipal Academy of Higher Education", city: "Manipal", state: "Karnataka", type: "Deemed University", aliases: ["Manipal University"] },
  { id: "KA-U-CHRIST", name: "CHRIST (Deemed to be University)", city: "Bengaluru", state: "Karnataka", type: "Deemed University", aliases: ["Christ University Bangalore"] },
  { id: "DL-U-DU", name: "University of Delhi", city: "Delhi", state: "Delhi", type: "Central University", aliases: ["Delhi University", "DU"] },
  { id: "DL-U-IITD", name: "Indian Institute of Technology Delhi", city: "New Delhi", state: "Delhi", type: "Institute of National Importance", aliases: ["IIT Delhi"] },
  { id: "DL-U-JNU", name: "Jawaharlal Nehru University", city: "New Delhi", state: "Delhi", type: "Central University", aliases: ["JNU Delhi"] },
  { id: "MH-U-IITB", name: "Indian Institute of Technology Bombay", city: "Mumbai", state: "Maharashtra", type: "Institute of National Importance", aliases: ["IIT Bombay", "IIT Mumbai"] },
  { id: "MH-U-MU", name: "University of Mumbai", city: "Mumbai", state: "Maharashtra", type: "State Public University", aliases: ["Mumbai University"] },
  { id: "MH-U-SYMBIOSIS", name: "Symbiosis International (Deemed University)", city: "Pune", state: "Maharashtra", type: "Deemed University", aliases: ["Symbiosis University Pune"] },
  { id: "WB-U-IITKGP", name: "Indian Institute of Technology Kharagpur", city: "Kharagpur", state: "West Bengal", type: "Institute of National Importance", aliases: ["IIT Kharagpur"] },
  { id: "UP-U-IITK", name: "Indian Institute of Technology Kanpur", city: "Kanpur", state: "Uttar Pradesh", type: "Institute of National Importance", aliases: ["IIT Kanpur"] },
  { id: "UP-U-BHU", name: "Banaras Hindu University", city: "Varanasi", state: "Uttar Pradesh", type: "Central University", aliases: ["BHU Varanasi"] },
  { id: "TS-U-IITH", name: "Indian Institute of Technology Hyderabad", city: "Hyderabad", state: "Telangana", type: "Institute of National Importance", aliases: ["IIT Hyderabad"] },
  { id: "TS-U-UOH", name: "University of Hyderabad", city: "Hyderabad", state: "Telangana", type: "Central University", aliases: ["Hyderabad Central University", "UoH"] },
  { id: "RJ-U-BITS", name: "Birla Institute of Technology and Science — Pilani", city: "Pilani", state: "Rajasthan", type: "Deemed University", aliases: ["BITS Pilani"] },
  { id: "TN-U-JEU", name: "Jeppiaar University", city: "Chennai", state: "Tamil Nadu", type: "Private University", aliases: ["Jeppiaar University Chennai", "JU Chennai", "Jeppiaar"] },
];
