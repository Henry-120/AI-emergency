/**
 * 姓名的拆與合。醫療卡把「姓」「名」分開填，但後端與舊資料只有一個全名（full_name）。
 */

/** 台灣常見複姓。拆舊資料的全名時先比對這些，其餘一律取第一個字當姓。 */
const COMPOUND_SURNAMES = [
  "歐陽", "司馬", "諸葛", "上官", "司徒", "東方", "西門", "南宮", "皇甫", "尉遲",
  "公孫", "慕容", "長孫", "宇文", "令狐", "端木", "夏侯", "軒轅", "鮮于", "呼延",
  "張簡", "范姜", "張廖", "周黃", "徐辜",
];

const CHINESE_NAME = /^[一-鿿]{2,5}$/;

/**
 * 舊資料只有全名時，盡量拆成姓＋名；拆錯使用者可以在表單改。
 * 不是純中文的名字（英文名、原住民名字的「·」等）不亂拆，整串放進「名」，組回去仍是原字串。
 */
export function splitFullName(fullName: string): { lastName: string; firstName: string } {
  const name = fullName.trim();
  if (!CHINESE_NAME.test(name)) return { lastName: "", firstName: name };
  const surnameLength =
    name.length > 2 && COMPOUND_SURNAMES.some((surname) => name.startsWith(surname)) ? 2 : 1;
  return { lastName: name.slice(0, surnameLength), firstName: name.slice(surnameLength) };
}

/** 姓＋名組成全名。中文不加空格；兩邊都是英文字母時中間空一格（如 "Smith John"）。 */
export function joinFullName(lastName: string, firstName: string): string {
  const last = lastName.trim();
  const first = firstName.trim();
  return /[A-Za-z]$/.test(last) && /^[A-Za-z]/.test(first) ? `${last} ${first}` : `${last}${first}`;
}
