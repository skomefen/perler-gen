/* ══════════════════════════════════════════════════════════════
   palettes.js — 拼豆色卡数据
   ──────────────────────────────────────────────────────────────
   数据来源：比特拼豆 Bitbead 开放色卡数据集
     https://www.bitbead.app/zh/colors
     https://github.com/pomodiary/bitbead.app/tree/main/data
   许可：CC BY 4.0

   说明：
   · 色值为产品照片与厂商色卡取样所得，非分光光度计实测；
     与实际豆子存在批次差异，ΔE 小于 1 的差别可视为噪声。
   · Artkal 2.6mm 为小号豆，尺寸与 5mm 不通用的颜色匹配不代表可互换。
   · COCO 与 MARD 291 是同一套色值换了编号：291 个色里 290 个 hex 一致，
     但两边同号色号只有 48 个、且各指不同颜色。照色号平移会买错豆子。
   ══════════════════════════════════════════════════════════════ */

/* 各字母分组的大致色相，用于界面上解释编号含义 */
const GROUP_LABELS = {
  A: '黄 / 橙', B: '绿', C: '蓝 / 青', D: '紫 / 蓝紫',
  E: '粉 / 玫红', F: '红 / 肤色', G: '棕 / 大地', H: '灰 / 黑白',
  M: '莫兰迪', P: '珠光', Q: '温变', R: '果冻',
  T: '透明', Y: '夜光', ZG: '光变',
  MA: '黄橙', MB: '绿', MC: '蓝青', MD: '紫', ME: '粉',
  MF: '红', MG: '棕肤', MH: '灰白', MM: '灰调',
  S: '标准色', SE: '扩展色', J: '蓝紫', K: '肤色粉',
  L: '果冻', N: '夜光', GB: '国标', W: '温变', Z: '棕褐',
};

/* ── MARD 漫漫 221 · 221 色 ─────────────────────────────── */
const MARD_BEADS = [
  ['A1','#FAF4C8'],['A2','#FFFFD5'],['A3','#FEFF8B'],['A4','#FBED56'],
  ['A5','#F4D738'],['A6','#FEAC4C'],['A7','#FE8B4C'],['A8','#FFDA45'],
  ['A9','#FF995B'],['A10','#F77C31'],['A11','#FFDD99'],['A12','#FE9F72'],
  ['A13','#FFC365'],['A14','#FD543D'],['A15','#FFF365'],['A16','#FFFF9F'],
  ['A17','#FFE36E'],['A18','#FEBE7D'],['A19','#FD7C72'],['A20','#FFD568'],
  ['A21','#FFE395'],['A22','#F4F57D'],['A23','#E6C9B7'],['A24','#F7F8A2'],
  ['A25','#FFD67D'],['A26','#FFC830'],['B1','#E6EE31'],['B2','#63F347'],
  ['B3','#9EF780'],['B4','#5DE035'],['B5','#35E352'],['B6','#65E2A6'],
  ['B7','#3DAF80'],['B8','#1C9C4F'],['B9','#27523A'],['B10','#95D3C2'],
  ['B11','#5D722A'],['B12','#166F41'],['B13','#CAEB7B'],['B14','#ADE946'],
  ['B15','#2E5132'],['B16','#C5ED9C'],['B17','#9BB13A'],['B18','#E6EE49'],
  ['B19','#24B88C'],['B20','#C2F0CC'],['B21','#156A6B'],['B22','#0B3C43'],
  ['B23','#303A21'],['B24','#EEFCA5'],['B25','#4E846D'],['B26','#8D7A35'],
  ['B27','#CCE1AF'],['B28','#9EE5B9'],['B29','#C5E254'],['B30','#E2FCB1'],
  ['B31','#B0E792'],['B32','#9CAB5A'],['C1','#E8FFE7'],['C2','#A9F9FC'],
  ['C3','#A0E2FB'],['C4','#41CCFF'],['C5','#01ACEB'],['C6','#50AAF0'],
  ['C7','#3677D2'],['C8','#0F54C0'],['C9','#324BCA'],['C10','#3EBCE2'],
  ['C11','#28DDDE'],['C12','#1C334D'],['C13','#CDE8FF'],['C14','#D5FDFF'],
  ['C15','#22C4C6'],['C16','#1557A8'],['C17','#04D1F6'],['C18','#1D3344'],
  ['C19','#1887A2'],['C20','#176DAF'],['C21','#BEDDFF'],['C22','#67B4BE'],
  ['C23','#C8E2FF'],['C24','#7CC4FF'],['C25','#A9E5E5'],['C26','#3CAED8'],
  ['C27','#D3DFFA'],['C28','#BBCFED'],['C29','#34488E'],['D1','#AEB4F2'],
  ['D2','#858EDD'],['D3','#2F54AF'],['D4','#182A84'],['D5','#B843C5'],
  ['D6','#AC7BDE'],['D7','#8854B3'],['D8','#E2D3FF'],['D9','#D5B9F8'],
  ['D10','#361851'],['D11','#B9BAE1'],['D12','#DE9AD4'],['D13','#B90095'],
  ['D14','#8B279B'],['D15','#2F1F90'],['D16','#E3E1EE'],['D17','#C4D4F6'],
  ['D18','#A45EC7'],['D19','#D8C3D7'],['D20','#9C32B2'],['D21','#9A009B'],
  ['D22','#333A95'],['D23','#EBDAFC'],['D24','#7786E5'],['D25','#494FC7'],
  ['D26','#DFC2F8'],['E1','#FDD3CC'],['E2','#FEC0DF'],['E3','#FFB7E7'],
  ['E4','#E8649E'],['E5','#F551A2'],['E6','#F13D74'],['E7','#C63478'],
  ['E8','#FFDBE9'],['E9','#E970CC'],['E10','#D33793'],['E11','#FCDDD2'],
  ['E12','#F78FC3'],['E13','#B5006D'],['E14','#FFD1BA'],['E15','#F8C7C9'],
  ['E16','#FFF3EB'],['E17','#FFE2EA'],['E18','#FFC7DB'],['E19','#FEBAD5'],
  ['E20','#D8C7D1'],['E21','#BD9DA1'],['E22','#B785A1'],['E23','#937A8D'],
  ['E24','#E1BCE8'],['F1','#FD957B'],['F2','#FC3D46'],['F3','#F74941'],
  ['F4','#FC283C'],['F5','#E7002F'],['F6','#943630'],['F7','#971937'],
  ['F8','#BC0028'],['F9','#E2677A'],['F10','#8A4526'],['F11','#5A2121'],
  ['F12','#FD4E6A'],['F13','#F35744'],['F14','#FFA9AD'],['F15','#D30022'],
  ['F16','#FEC2A6'],['F17','#E69C79'],['F18','#D37C46'],['F19','#C1444A'],
  ['F20','#CD9391'],['F21','#F7B4C6'],['F22','#FDC0D0'],['F23','#F67E66'],
  ['F24','#E698AA'],['F25','#E54B4F'],['G1','#FFE2CE'],['G2','#FFC4AA'],
  ['G3','#F4C3A5'],['G4','#E1B383'],['G5','#EDB045'],['G6','#E99C17'],
  ['G7','#9D5B3E'],['G8','#753832'],['G9','#E6B483'],['G10','#D98C39'],
  ['G11','#E0C593'],['G12','#FFC890'],['G13','#B7714A'],['G14','#8D614C'],
  ['G15','#FCF9E0'],['G16','#F2D9BA'],['G17','#78524B'],['G18','#FFE4CC'],
  ['G19','#E07935'],['G20','#A94023'],['G21','#B88558'],['H1','#FDFBFF'],
  ['H2','#FEFFFF'],['H3','#B6B1BA'],['H4','#89858C'],['H5','#48464E'],
  ['H6','#2F2B2F'],['H7','#000000'],['H8','#E7D6DB'],['H9','#EDEDED'],
  ['H10','#EEE9EA'],['H11','#CECDD5'],['H12','#FFF5ED'],['H13','#F5ECD2'],
  ['H14','#CFD7D3'],['H15','#98A6A8'],['H16','#1D1414'],['H17','#F1EDED'],
  ['H18','#FFFDF0'],['H19','#F6EFE2'],['H20','#949FA3'],['H21','#FFFBE1'],
  ['H22','#CACAD4'],['H23','#9A9D94'],['M1','#BCC6B8'],['M2','#8AA386'],
  ['M3','#697D80'],['M4','#E3D2BC'],['M5','#D0CCAA'],['M6','#B0A782'],
  ['M7','#B4A497'],['M8','#B38281'],['M9','#A58767'],['M10','#C5B2BC'],
  ['M11','#9F7594'],['M12','#644749'],['M13','#D19066'],['M14','#C77362'],
  ['M15','#757D78'],
];

/* ── COCO 可可 291 · 291 色 ─────────────────────────────── */
const COCO_BEADS = [
  ['E02','#FAF4C8'],['E01','#FFFFD5'],['E05','#FEFF8B'],['E07','#FBED56'],
  ['D03','#F4D738'],['D05','#FEAC4C'],['D08','#FE8B4C'],['E08','#FFDA45'],
  ['D06','#FF995B'],['D07','#F77C31'],['D01','#FFDD99'],['K09','#FE9F72'],
  ['D04','#FFC365'],['C05','#FD543D'],['E04','#FFF365'],['E03','#FFFF9F'],
  ['E06','#FFE36E'],['D02','#FEBE7D'],['K10','#FD7C72'],['E09','#FFD568'],
  ['E10','#FFE395'],['E11','#F4F57D'],['E12','#E6C9B7'],['E13','#F7F8A2'],
  ['E14','#FFD67D'],['E15','#FFC830'],['F05','#E6EE31'],['F08','#63F347'],
  ['F04','#9EF780'],['F09','#5DE035'],['F10','#35E352'],['G04','#65E2A6'],
  ['G05','#3DAF80'],['F11','#1C9C4F'],['F16','#27523A'],['G03','#95D3C2'],
  ['F14','#5D722A'],['F12','#166F41'],['F02','#CAEB7B'],['F06','#ADE946'],
  ['F15','#2E5132'],['F03','#C5ED9C'],['F13','#9BB13A'],['F07','#E6EE49'],
  ['G06','#24B88C'],['G02','#C2F0CC'],['G07','#156A6B'],['G08','#0B3C43'],
  ['F17','#303A21'],['F01','#EEFCA5'],['F18','#4E846D'],['F19','#8D7A35'],
  ['F20','#CCE1AF'],['F21','#9EE5B9'],['F22','#C5E254'],['F23','#E2FCB1'],
  ['F24','#B0E792'],['F25','#9CAB5A'],['G01','#E8FFE7'],['H03','#A9F9FC'],
  ['H04','#A0E2FB'],['H05','#41CCFF'],['H07','#01ACEB'],['H08','#50AAF0'],
  ['H13','#3677D2'],['H14','#0F54C0'],['H16','#324BCA'],['H09','#3EBCE2'],
  ['H10','#28DDDE'],['H23','#1C334D'],['H01','#CDE8FF'],['H02','#D5FDFF'],
  ['H11','#22C4C6'],['H18','#1557A8'],['H19','#04D1F6'],['H24','#1D3344'],
  ['H12','#1887A2'],['H17','#176DAF'],['H06','#BEDDFF'],['H25','#67B4BE'],
  ['H26','#C8E2FF'],['H27','#7CC4FF'],['H28','#A9E5E5'],['H29','#3CAED8'],
  ['H30','#D3DFFA'],['H31','#BBCFED'],['H32','#34488E'],['J07','#AEB4F2'],
  ['J08','#858EDD'],['H15','#2F54AF'],['H20','#182A84'],['J12','#B843C5'],
  ['J11','#AC7BDE'],['J15','#8854B3'],['J03','#E2D3FF'],['J04','#D5B9F8'],
  ['J19','#361851'],['J06','#B9BAE1'],['J10','#DE9AD4'],['J14','#B90095'],
  ['J16','#8B279B'],['H22','#2F1F90'],['J01','#E3E1EE'],['J05','#C4D4F6'],
  ['J13','#A45EC7'],['J09','#D8C3D7'],['J17','#9C32B2'],['J18','#9A009B'],
  ['H21','#333A95'],['J02','#EBDAFC'],['J20','#7786E5'],['J21','#494FC7'],
  ['J22','#DFC2F8'],['K03','#FDD3CC'],['K15','#FEC0DF'],['K17','#FFB7E7'],
  ['K21','#E8649E'],['K19','#F551A2'],['K22','#F13D74'],['K25','#C63478'],
  ['K12','#FFDBE9'],['K18','#E970CC'],['K23','#D33793'],['K02','#FCDDD2'],
  ['K16','#F78FC3'],['K24','#B5006D'],['K05','#FFD1BA'],['K04','#F8C7C9'],
  ['K01','#FFF3EB'],['K11','#FFE2EA'],['K13','#FFC7DB'],['K14','#FEBAD5'],
  ['K26','#D8C7D1'],['K27','#BD9DA1'],['K28','#B785A1'],['K29','#937A8D'],
  ['K30','#E1BCE8'],['K08','#FD957B'],['C02','#FC3D46'],['C03','#F74941'],
  ['C06','#FC283C'],['C07','#E7002F'],['Z21','#943630'],['C10','#971937'],
  ['C09','#BC0028'],['K20','#E2677A'],['Z20','#8A4526'],['Z23','#5A2121'],
  ['C01','#FD4E6A'],['C04','#F35744'],['K07','#FFA9AD'],['C08','#D30022'],
  ['K06','#FEC2A6'],['K31','#E69C79'],['K32','#D37C46'],['K33','#C1444A'],
  ['K34','#CD9391'],['K35','#F7B4C6'],['K36','#FDC0D0'],['K37','#F67E66'],
  ['K38','#E698AA'],['K39','#E54B4F'],['Z02','#FFE2CE'],['Z05','#FFC4AA'],
  ['Z06','#F4C3A5'],['Z08','#E1B383'],['Z10','#EDB045'],['Z11','#E99C17'],
  ['Z18','#9D5B3E'],['Z22','#753832'],['Z09','#E6B483'],['Z15','#D98C39'],
  ['Z07','#E0C593'],['Z13','#FFC890'],['Z14','#B7714A'],['Z17','#8D614C'],
  ['Z03','#FCF9E0'],['Z04','#F2D9BA'],['Z16','#78524B'],['Z01','#FFE4CC'],
  ['Z12','#E07935'],['Z19','#A94023'],['Z24','#B88558'],['A02','#FDFBFF'],
  ['A01','#FEFFFF'],['B03','#B6B1BA'],['B05','#89858C'],['B06','#48464E'],
  ['B07','#2F2B2F'],['B09','#000000'],['A09','#E7D6DB'],['A08','#EDEDED'],
  ['A10','#EEE9EA'],['B01','#CECDD5'],['A04','#FFF5ED'],['A06','#F5ECD2'],
  ['B02','#CFD7D3'],['B04','#98A6A8'],['B08','#1D1414'],['A07','#F1EDED'],
  ['A03','#FFFDF0'],['A05','#F6EFE2'],['B10','#949FA3'],['A11','#FFFBE1'],
  ['A12','#CACAD4'],['B11','#9A9D94'],['Y01','#BCC6B8'],['Y02','#8AA386'],
  ['Y03','#697D80'],['Y04','#E3D2BC'],['Y05','#D0CCAA'],['Y06','#B0A782'],
  ['Y07','#B4A497'],['Y08','#B38281'],['Y09','#A58767'],['Y10','#C5B2BC'],
  ['Y11','#9F7594'],['Y12','#644749'],['Y13','#D19066'],['Y14','#C77362'],
  ['Y15','#757D78'],['M01','#FCF7F8'],['M02','#B0A9AC'],['M03','#AFDCAB'],
  ['M04','#FEA49F'],['M05','#EE8C3E'],['M06','#5FD0A7'],['M07','#EB9270'],
  ['M08','#F0D958'],['M09','#D9D9D9'],['M10','#D9C7EA'],['M11','#F3ECC9'],
  ['M12','#E6EEF2'],['M13','#AACBEF'],['M14','#337680'],['M15','#668575'],
  ['M16','#FEBF45'],['M17','#FEA324'],['M18','#FEB89F'],['M19','#FFFEEC'],
  ['M21','#FEBECF'],['M20','#ECBEBF'],['M22','#E4A89F'],['M23','#A56268'],
  ['W3','#F2A5E8'],['W4','#E9EC91'],['W1','#FFFF00'],['W2','#FFEBFA'],
  ['W5','#76CEDE'],['L01','#D50D21'],['L02','#F92F83'],['L03','#FD8324'],
  ['L04','#F8EC31'],['L05','#35C75B'],['L06','#238891'],['L07','#19779D'],
  ['L08','#1A60C3'],['L09','#9A56B4'],['L10','#FFDB4C'],['L11','#FFEBFB'],
  ['L12','#D8D5CE'],['L13','#55514C'],['S1','#9FE4DF'],['S2','#77CEE9'],
  ['S3','#3ECFCA'],['S4','#4A867A'],['S5','#7FCD9D'],['S6','#CDE55D'],
  ['S7','#E8C7B4'],['S8','#AD6F3C'],['S9','#6C372F'],['S10','#FEB872'],
  ['S11','#F3C1C0'],['S12','#C9675E'],['S13','#D293BE'],['S14','#EA8CB1'],
  ['S15','#9C87D6'],['L14','#FFFFFF'],['N01','#FD6FB4'],['N02','#FEB481'],
  ['N03','#D7FAA0'],['N04','#8BDBFA'],['N05','#E987EA'],['GB1','#DAABB3'],
  ['GB2','#D6AA87'],['GB3','#C1BD8D'],['GB4','#96869F'],['GB5','#8490A6'],
  ['GB6','#94BFE2'],['GB7','#E2A9D2'],['GB8','#AB91C0'],
];

/* ── Perler 帕勒 · 103 色 ───────────────────────────────── */
const PERLER_BEADS = [
  ['P15179','#305545','Evergreen'],['P15181','#B3BAB8','Light Grey'],['P15182','#AF9FCE','Lavender'],['P15199','#008F53','Shamrock'],
  ['P15200','#0065B1','Cobalt'],['P15201','#2F3C55','Midnight'],['P15202','#A9CDD5','Robin\'s Egg'],['P15203','#F2AFB7','Flamingo'],
  ['P15204','#E1747A','Salmon'],['P15205','#C9A385','Fawn'],['P15206','#94A19D','Pewter'],['P15207','#4F595A','Charcoal'],
  ['P15208','#DEDACE','Toasted Marshmallow'],['P15210','#B1628E','Orchid'],['P15211','#D14337','Tomato'],['P15212','#D9593A','Spice'],
  ['P15213','#F5A168','Apricot'],['P15214','#D8E47C','Sherbet'],['P15215','#93B0BD','Mist'],['P15216','#4AC0D8','Sky'],
  ['P15217','#00A4AC','Lagoon'],['P15218','#047F8A','Teal'],['P15219','#7F971A','Fern'],['P15220','#696E31','Olive'],
  ['P15961','#9D2B3A','Cherry'],['P19001','#EAEFEE','White'],['P19002','#E1E2BB','Creme'],['P19003','#E7CE3E','Yellow'],
  ['P19004','#EB7B31','Orange'],['P19005','#B0353C','Red'],['P19006','#D8729A','Bubblegum'],['P19007','#684B86','Purple'],
  ['P19008','#0E5092','Dark Blue'],['P19009','#278CC9','Light Blue'],['P19010','#007B4E','Dark Green'],['P19011','#18C7B1','Light Green'],
  ['P19012','#674C44','Brown'],['P19017','#909497','Grey'],['P19018','#323234','Black'],['P19020','#995043','Rust'],
  ['P19021','#936848','Light Brown'],['P19033','#E9BFB9','Peach'],['P19035','#C5AC90','Tan'],['P19038','#E04284','Magenta'],
  ['P19052','#4A9CCF','Pastel Blue'],['P19053','#6DCC94','Pastel Green'],['P19054','#937FBF','Pastel Lavender'],['P19056','#E9E290','Pastel Yellow'],
  ['P19057','#FBB146','Cheddar'],['P19058','#96D1D4','Toothpaste'],['P19059','#DD595B','Hot Coral'],['P19060','#A75D9D','Plum'],
  ['P19061','#69B845','Kiwi Lime'],['P19062','#0098C5','Turquoise'],['P19063','#F99297','Blush'],['P19070','#6683B7','Periwinkle Blue'],
  ['P19079','#E1BCCE','Light Pink'],['P19080','#4DAB64','Green'],['P19083','#D45496','Pink'],['P19088','#983864','Raspberry'],
  ['P19090','#DA9964','Butterscotch'],['P19091','#009188','Parrot Green'],['P19092','#585C61','Dark Grey'],['P19093','#85A8E3','Blueberry Creme'],
  ['P19096','#843947','Cranapple'],['P19097','#BBC938','Prickly Pear'],['P19098','#E5BE9E','Sand'],['P15240','#B3EED5','Mint'],
  ['P15241','#A3DE6F','Sour Apple'],['P15242','#F479B0','Cotton Candy'],['P15243','#503B9C','Grape'],['P15244','#D25D72','Rose'],
  ['P15245','#4E56A3','Iris'],['P15246','#FD5918','Tangerine'],['P15247','#005D57','Forest'],['P15248','#6F3255','Eggplant'],
  ['P15249','#DA8C2C','Honey'],['P15250','#7E5446','Gingerbread'],['P15251','#8C8CA7','Thistle'],['P15252','#5E6D7B','Slate Blue'],
  ['P15253','#4C6388','Denim'],['P15254','#9AA98E','Sage'],['P15255','#EFB79B','Orange Cream'],['P15256','#CA3B65','Fruit Punch'],
  ['P15257','#CB59B9','Fuchsia'],['P15258','#714875','Mulberry'],['P15259','#C8C85C','Slime'],['P15260','#988C8C','Stone'],
  ['P15261','#14313B','Dark Spruce'],['P15262','#392928','Cocoa'],['P15265','#C685B1','Twilight Plum'],['P15266','#6CC8AD','Caribbean Sea'],
  ['P15267','#CDB7C3','Frosted Lilac'],['P15273','#FC9574','Brick'],['P15274','#F6CA69','Rich Butter'],['P15275','#0090AC','Peacock'],
  ['P15276','#F8C7C9','Carnation Pink'],['P15089','#406AE1','Neon Blue'],['P15268','#DEBA0B','Sunflower'],['P15269','#F6D901','Lemon'],
  ['P15263','#BED4A6','Celery'],['P15239','#C8B693','Mocha'],['P15272','#FF9A8B','Coral'],
];

/* ── Hama 哈马 · 89 色 ─────────────────────────────────── */
const HAMA_BEADS = [
  ['H01','#ECEDED','White'],['H02','#F0E8B9','Cream'],['H03','#F0B901','Gold'],['H04','#E64F27','Orange'],
  ['H05','#B63136','Red'],['H06','#E1889F','Pink'],['H07','#694A82','Purple'],['H08','#2C4690','Dark Blue'],
  ['H09','#305CB0','Blue'],['H10','#256847','Dark Green'],['H11','#49AE89','Teal'],['H12','#534137','Brown'],
  ['H13','#C02435','Transparent Red'],['H14','#E4AA32','Transparent Yellow'],['H15','#487ED5','Transparent Blue'],['H16','#37B876','Transparent Green'],
  ['H17','#83888A','Gray'],['H18','#2E2F31','Black'],['H19','#D8D2CE','Clear'],['H20','#7F332A','Dark Brown'],
  ['H21','#A5693F','Tan'],['H22','#A52D36','Burgundy'],['H24','#683E9A','Translucent Purple'],['H25','#87593D','Translucent Brown'],
  ['H26','#DE9B90','Salmon'],['H27','#DEB48B','Tan Light'],['H28','#363F38','Dark Gray'],['H29','#B9395E','Magenta'],
  ['H30','#592F38','Maroon'],['H31','#6797AE','Steel Blue'],['H32','#FF208D','Neon Fuchsia'],['H33','#FF3956','Bright Red'],
  ['H34','#E5EF13','Neon Yellow'],['H35','#FF2833','Neon Red'],['H36','#2353B0','Neon Blue'],['H37','#06B73C','Neon Green'],
  ['H38','#FD8600','Neon Orange'],['H39','#F1F21C','Fluorescent Yellow'],['H40','#FE630B','Fluorescent Orange'],['H41','#2659B2','Fluorescent Blue'],
  ['H42','#0CBD51','Fluorescent Green'],['H43','#F0EA37','Bright Yellow'],['H44','#EE6972','Rose'],['H45','#886DB9','Mauve'],
  ['H46','#629ED7','Cornflower Blue'],['H47','#83CB70','Green'],['H48','#CF70B7','Orchid'],['H49','#4998BC','Ocean Blue'],
  ['H60','#F49422','Burnt Orange'],['H61','#D99350','Gold Metallic'],['H62','#48474A','Silver Metallic'],['H63','#42312F','Bronze Metallic'],
  ['H64','#EFEBE4','Pearl'],['H70','#B6B6D4','Periwinkle'],['H71','#464541','Charcoal'],['H72','#F097B0','Translucent Pink'],
  ['H73','#59AEF5','Translucent Aqua'],['H74','#5B55BD','Translucent Lilac'],['H75','#BF7B4D','Caramel'],['H76','#663317','Chocolate'],
  ['H77','#EDE7DF','Beige'],['H78','#FFC99A','Light Orange'],['H79','#F08643','Apricot'],['H82','#962F5C','Wine'],
  ['H83','#0178A4','Teal Blue'],['H84','#8B924C','Olive'],['H95','#F8CCE0','Light Pink'],['H96','#D4B1E3','Lilac'],
  ['H97','#A2D3FE','Light Blue'],['H98','#9ADBB1','Mint'],['H101','#A9C39B','Light Green'],['H102','#356B2D','Forest Green'],
  ['H103','#FFE660','Yellow'],['H104','#BCD122','Lime Green'],['H105','#FFAC78','Peach'],['H106','#CCC5ED','Lavender'],
  ['H107','#6A87C1','Sky Blue'],['H108','#2A2536','Aubergine'],['H109','#8A847F','Cloudy Grey'],['H110','#838956','Matcha'],
  ['H111','#835854','Dark Blush'],['H112','#AD8A82','Blush'],['H113','#5F887B','Aqua'],['H114','#9A2C31','Cherry Red'],
  ['H115','#6E975F','Bright Green'],['H116','#222838','Midnight Blue'],['H117','#777169','Taupe Grey'],['H118','#612932','Maroon Red'],
  ['H119','#4167B4','Sky Blue Clear'],
];

/* ── Artkal 5mm · 176 色 ──────────────────────────────── */
const ARTKAL_BEADS = [
  ['S01','#FFFFFF','White'],['S02','#FFA38B','Burning Sand'],['S03','#FF8200','Tangerine'],['S04','#FA4616','Orange'],
  ['S05','#EE2737','Tall Poppy'],['S06','#EF64A2','Raspberry Pink'],['S07','#97999B','Gray'],['S08','#26D07C','Emerald'],
  ['S09','#007371','Dark Green'],['S10','#56B7E6','Baby Blue'],['S11','#0050B5','Dark Blue'],['S12','#9063CD','Pastel Lavender'],
  ['S13','#000000','Black'],['S14','#FDDA24','Sandstorm'],['S15','#A72B2A','Redwood'],['S16','#674736','Brown'],
  ['S17','#7B4D35','Light Brown'],['S18','#EAA794','Sand'],['S19','#F8C1B8','Bubble Gum'],['S20','#249E6B','Green'],
  ['S21','#93C90E','Pastel Green'],['S22','#483698','Purple'],['S23','#7D55C7','Royal Purple'],['S24','#1164C9','True Blue'],
  ['S25','#EF60A3','Hot Pink'],['S26','#F04E98','Magenta'],['S27','#FFC72C','Yellow'],['S28','#EF95CF','Lily Pink'],
  ['S29','#FBDB65','Pastel Yellow'],['S30','#A4E6E8','Shadow Green'],['S31','#B5E3D8','Sea Mist'],['S32','#FECB8B','Beeswax'],
  ['S33','#C5B4E3','Maverick'],['S34','#D50032','Red'],['S35','#F7CED7','Mona Lisa'],['S36','#E06287','Old Pink'],
  ['S37','#8BD3E6','Blue-Green'],['S38','#BC204B','Burgundy'],['S39','#FF7F41','Yellow Orange'],['S40','#F99FC9','Carnation Pink'],
  ['S41','#9A5516','Copper'],['S42','#A09F9D','Silver'],['S43','#75787B','Dark Gray'],['S44','#9BCBEB','Sky Blue'],
  ['S45','#00B2A9','Medium Turquoise'],['S46','#8EDD65','Bright Green'],['S47','#A6631B','Marigold'],['S48','#FFC845','Corn'],
  ['S49','#973961','Mulberry Wood'],['S50','#FFB3AB','Mandys Pink'],['S51','#FFF8DB','Spring Sun'],['S52','#F8E08E','Picasso'],
  ['S53','#62A0E6','Blue Enchantress'],['S54','#0090DA','Light Blue'],['S55','#ADDC91','Pistachio'],['S56','#FF6A39','Bright Carrot'],
  ['S57','#B33D26','Buccaneer'],['S58','#BA0C2F','Paprika'],['S59','#5949A7','Butterfly Bush'],['S60','#9678D3','Lavender'],
  ['S61','#E6DE77','Key Lemon Pie'],['S62','#007C58','Green Tea'],['S63','#4C5914','Metallic Gold'],['S64','#2C2D65','Black Rock'],
  ['S65','#F0EC74','Canary'],['S66','#EE5340','Blaze Orange'],['S67','#ECC3B2','Vanilla'],['S68','#E7B78A','Tan'],
  ['S69','#212721','Mine Shaft'],['S70','#BABC16','Dark Algae'],['S71','#008522','Jade Green'],['S72','#67D9DF','Light Sea Blue'],
  ['S73','#48A9C5','Steel Blue'],['S74','#04A9C7','Azure'],['S75','#0085AD','Dark Steel Blue'],['S76','#00A7B5','Sea Blue'],
  ['S77','#D9D9D6','Ghost White'],['S78','#C8C9C7','Ash Gray'],['S79','#B1B3B3','Light Gray'],['S80','#A2A569','Dark Olive'],
  ['S81','#D5A286','Deer'],['S82','#C58B68','Clay'],['S83','#B15533','Sienna'],['S84','#AB5C57','Deep Chestnut'],
  ['S85','#8A2A2B','Red Wine'],['S86','#F29D04','Goldenrod'],['S87','#FF808B','Coral Red'],['S88','#DA1884','Dark Pink'],
  ['S89','#53565A','Charcoal Gray'],['S90','#FFC56E','Pastel Orange'],['S91','#183028','Brunswick Green'],['S92','#C69214','Dandelion'],
  ['S93','#EDC8A3','Pale Skin'],['S94','#EAA794','Warm Blush'],['S95','#E8927C','Salmon'],['S96','#FF8D6D','Apricot'],
  ['S97','#E35205','Papaya'],['S98','#80B6E8','Himalaya Blue'],['S99','#5CA9CC','Waterfall'],['S100','#5DB3CB','Lagoon'],
  ['S101','#00A3E1','Electric Blue'],['S102','#0077CF','Pool Blue'],['S103','#0067B9','Caribbean Blue'],['S104','#007DBA','Deep Water'],
  ['S105','#00859B','Petrol Blue'],['S106','#0076A8','Wedgewood Blue'],['S107','#007096','Pond Blue'],['S108','#E6C78A','Seashell Beige'],
  ['S109','#CEB888','Beige'],['S110','#C6AA76','Beach Beige'],['S111','#A08629','Caffe Latte'],['S112','#897630','Oaktree Brown'],
  ['S113','#C3C6A8','Khaki'],['S114','#C0BB87','Light Greengray'],['S115','#B0AA7E','Mossy Green'],['S116','#A3AA83','Earth Green'],
  ['S117','#77744D','Sage Green'],['S118','#5E6738','Pinetree Green'],['S119','#98DBCE','Frosty Blue'],['S120','#9BE3BF','Polar Mint'],
  ['S121','#6BBBAE','Celadon Green'],['S122','#00BB7E','Eucalyptus'],['S123','#31B700','Clover Field'],['S124','#035F1D','Pooltable Felt'],
  ['S125','#007864','Snake Green'],['S126','#00685E','Dark Eucalyptus'],['S127','#DECDE7','Marshmallow Rose'],['S128','#C98BDB','Light Grape'],
  ['S129','#DCB6C9','Rosebud Pink'],['S130','#DD74A1','Fuchsia'],['S131','#AD96DC','Candy Violet'],['S132','#EF426F','Flamingo'],
  ['S133','#C724B1','Pink Plum'],['S134','#8031A7','Amethyst'],['S135','#9FAEE5','Moonlight Blue'],['S136','#B4B2E4','Summer Rain'],
  ['S137','#5F8DDA','Azur Blue'],['S138','#5780D2','Cornflower Blue'],['S139','#5576D1','Forget Me Not'],['S140','#3C62C3','Indigo'],
  ['S141','#466CCA','Horizon Blue'],['S142','#365ABD','Cobalt'],['S143','#1E22AA','Royal Blue'],['S144','#002D72','Marine'],
  ['S145','#E9E186','Pale Yellow Moss'],['S146','#8C243D','Bloodrose Red'],['S147','#86C8BC','Spearmint'],['S148','#724736','Mocha'],
  ['S149','#FCD299','Creme'],['S150','#8B84D7','Iris Violet'],['S151','#335525','Forrest Green'],['S152','#A7A4E0','Lilac'],
  ['S153','#C6C4EA','Pale Lilac'],['S154','#EBC29D','Sahara Sand'],['S155','#C58B68','Sunkissed Teint'],['S156','#63666A','Steel Grey'],
  ['S157','#46494C','Iron Grey'],['S158','#191D19','Pepper'],['S159','#88888D','Oslo Gray'],['SE01','#D1DDE6','Extended Pale Blue'],
  ['SE02','#9BB8E3','Extended Light Blue'],['SE03','#5E8AB4','Extended Medium Blue'],['SE04','#6AD1E3','Extended Cyan'],['SE05','#03C1AA','Extended Teal'],
  ['SE06','#126AD4','Extended Bright Blue'],['SE07','#BFA5B8','Extended Dusty Mauve'],['SE08','#9B7793','Extended Muted Purple'],['SE09','#693C5E','Extended Dark Plum'],
  ['SE10','#C964CF','Extended Bright Magenta'],['SE11','#AD1AAC','Extended Deep Magenta'],['SE12','#FFB25B','Extended Light Orange'],['SE13','#E6A65D','Extended Caramel'],
  ['SE14','#D38235','Extended Dark Caramel'],['SE15','#C16C18','Extended Burnt Caramel'],['SE16','#F5B6CD','Extended Light Pink'],['SE17','#5D2A2C','Extended Maroon'],
];

/* ── Artkal 2.6mm 迷你 · 221 色 ─────────────────────────── */
const ARTKAL_MINI_BEADS = [
  ['MA1','#FFF6D4','淡黄色 / Pale Yellow'],['MA2','#F6F9E5','浅黄色 / Light Yellow'],['MA3','#FFFBAA','亮黄色 / Bright Yellow'],['MA4','#FFDF58','金黄色 / Golden Yellow'],
  ['MA5','#FECF4D','深金黄 / Deep Gold'],['MA6','#FFA80C','橙黄色 / Orange Yellow'],['MA7','#FF8837','橙色 / Orange'],['MA8','#EAC431','柔和橙 / Soft Orange'],
  ['MA9','#F1AA8F','浅橙色 / Light Orange'],['MA10','#FF8F42','深橙色 / Deep Orange'],['MA11','#FFE1A1','浅杏色 / Light Apricot'],['MA12','#F4B39C','杏色 / Apricot'],
  ['MA13','#FFB100','浅黄橙 / Light Yellow-Orange'],['MA14','#FF6510','红橙色 / Red-Orange'],['MA15','#DAF05C','柠檬黄 / Lemon Yellow'],['MA16','#F9FBBE','亮柠檬 / Bright Lemon'],
  ['MA17','#FFD976','蛋黄色 / Yolk'],['MA18','#FFCA9A','浅橙棕 / Light Orange-Brown'],['MA19','#EC7A92','浅红橙 / Light Red-Orange'],['MA20','#E5BE55','蜜黄色 / Honey'],
  ['MA21','#FFE596','浅蜜黄 / Light Honey'],['MA22','#F7E898','黄绿色 / Yellow-Green'],['MA23','#F0CBB1','米黄色 / Beige Yellow'],['MA24','#F5FCD1','浅黄绿 / Light Yellow-Green'],
  ['MA25','#F6D487','淡黄绿 / Pale Yellow-Green'],['MA26','#FFCB4B','金色 / Gold'],['MB1','#D2E318','黄绿 / Yellow-Green'],['MB2','#79CD41','亮绿 / Bright Green'],
  ['MB3','#82D7A1','浅绿 / Light Green'],['MB4','#65DF4F','春绿 / Spring Green'],['MB5','#5FC873','鲜绿 / Vivid Green'],['MB6','#49D1AE','薄荷绿 / Mint'],
  ['MB7','#009696','森林绿 / Forest'],['MB8','#08774F','深绿 / Deep Green'],['MB9','#183823','暗绿 / Dark Green'],['MB10','#83CFC3','柔和绿 / Soft Green'],
  ['MB11','#5A6A27','军绿 / Army Green'],['MB12','#045F45','深森林绿 / Deep Forest'],['MB13','#E2FFB3','淡绿 / Pale Green'],['MB14','#9DD12E','青草绿 / Grass Green'],
  ['MB15','#254B3C','深青绿 / Deep Teal Green'],['MB16','#D0FCAD','浅青绿 / Light Teal Green'],['MB17','#8CA12A','橄榄绿 / Olive'],['MB18','#D2D958','黄绿亮 / Bright Yellow-Green'],
  ['MB19','#49BCA9','翡翠绿 / Emerald'],['MB20','#E8FDEC','薄荷淡绿 / Mint Light'],['MB21','#188B81','深蓝绿 / Deep Blue-Green'],['MB22','#0C5C5B','深青 / Deep Teal'],
  ['MB23','#3D461B','橄榄棕 / Olive Brown'],['MB24','#EAFCB6','柔和黄绿 / Soft Yellow-Green'],['MB25','#538771','墨绿 / Ink Green'],['MB26','#8A7A40','棕绿 / Brown-Green'],
  ['MB27','#D2DEB6','淡灰绿 / Pale Gray-Green'],['MB28','#9FF4C2','浅薄荷绿 / Light Mint'],['MB29','#BBD747','黄绿色 / Yellow-Green'],['MB30','#F5FFE6','淡黄绿 / Pale Yellow-Green'],
  ['MB31','#BFE1C2','浅草绿 / Light Grass'],['MB32','#9FBA5C','灰绿 / Gray-Green'],['MC1','#D5E3DE','淡白绿 / Pale White-Green'],['MC2','#BBF1F4','亮青 / Bright Cyan'],
  ['MC3','#73C0DF','浅青 / Light Cyan'],['MC4','#33B3E1','天青 / Sky Cyan'],['MC5','#00A3CA','深天青 / Deep Sky'],['MC6','#58A0D9','浅蓝 / Light Blue'],
  ['MC7','#0588CC','中蓝 / Medium Blue'],['MC8','#005F9E','深蓝 / Deep Blue'],['MC9','#086FB9','皇蓝 / Royal Blue'],['MC10','#52B4E0','天空蓝 / Sky Blue'],
  ['MC11','#00A9B9','松绿蓝 / Pine Blue'],['MC12','#1C375A','深夜蓝 / Midnight Blue'],['MC13','#CEE0F0','浅蓝白 / Light Blue-White'],['MC14','#EBF5F4','淡青绿 / Pale Cyan-Green'],
  ['MC15','#00AAAD','青蓝 / Cyan Blue'],['MC16','#004C7D','深蓝紫 / Deep Blue-Purple'],['MC17','#5BD4F6','亮青蓝 / Bright Cyan-Blue'],['MC18','#36515C','深灰蓝 / Deep Gray-Blue'],
  ['MC19','#0F909D','深青蓝 / Deep Cyan-Blue'],['MC20','#0084B7','深海蓝 / Deep Sea Blue'],['MC21','#DDECFA','淡蓝 / Pale Blue'],['MC22','#84BAC2','灰蓝 / Gray Blue'],
  ['MC23','#CBDBDB','浅蓝 / Light Blue'],['MC24','#88BDE2','空蓝 / Air Blue'],['MC25','#B3ECE0','浅青蓝 / Light Cyan-Blue'],['MC26','#3E9EBF','深青蓝 / Deep Cyan-Blue'],
  ['MC27','#E9F0F3','淡紫蓝 / Pale Purple-Blue'],['MC28','#C2CDE3','灰紫蓝 / Gray Purple-Blue'],['MC29','#586B8F','深紫蓝 / Deep Purple-Blue'],['MD1','#7292E2','浅紫 / Light Purple'],
  ['MD2','#6E8CCC','紫罗兰 / Violet'],['MD3','#13419A','中紫 / Medium Purple'],['MD4','#1E3175','深紫 / Deep Purple'],['MD5','#B850B2','品红 / Magenta'],
  ['MD6','#AD92E9','浅紫罗兰 / Light Violet'],['MD7','#5F2D91','葡萄紫 / Grape'],['MD8','#D7CDF1','淡紫 / Pale Purple'],['MD9','#BDB2E6','浅葡萄紫 / Light Grape'],
  ['MD10','#251B58','深葡萄 / Deep Grape'],['MD11','#A2BBE7','灰紫 / Gray Purple'],['MD12','#CF8BBE','玫瑰紫 / Rose Purple'],['MD13','#B80096','深品红 / Deep Magenta'],
  ['MD14','#A137A7','紫红 / Purple-Red'],['MD15','#4A388A','深蓝紫 / Deep Blue-Purple'],['MD16','#DCE8F6','淡紫白 / Pale Purple-White'],['MD17','#AECEF0','淡蓝紫 / Pale Blue-Purple'],
  ['MD18','#B38EDB','深紫罗兰 / Deep Violet'],['MD19','#E8D2EA','淡玫瑰紫 / Pale Rose Purple'],['MD20','#B460C3','兰紫 / Orchid Purple'],['MD21','#842A94','深兰紫 / Deep Orchid'],
  ['MD22','#4B5E9E','深紫蓝 / Deep Purple-Blue'],['MD23','#D6D2E2','浅紫白 / Light Purple-White'],['MD24','#7776D1','紫蓝 / Purple-Blue'],['MD25','#3837A8','深紫蓝 / Deep Purple-Blue'],
  ['MD26','#DDC8DD','淡紫粉 / Pale Purple-Pink'],['ME1','#FDD6C9','浅肉色 / Light Skin'],['ME2','#FFD8F4','淡粉红 / Pale Pink'],['ME3','#FFA0C3','浅粉紫 / Light Pink-Purple'],
  ['ME4','#F67AAB','粉红 / Pink'],['ME5','#DA5B95','亮粉红 / Bright Pink'],['ME6','#FF4B78','深粉红 / Deep Pink'],['ME7','#9E156B','暗粉红 / Dark Pink'],
  ['ME8','#FFE1E6','浅粉 / Light Pink'],['ME9','#F378CA','兰粉 / Orchid Pink'],['ME10','#BE316D','深兰粉 / Deep Orchid Pink'],['ME11','#FFE8DA','浅肤色 / Light Skin'],
  ['ME12','#FFA5C6','淡肤色 / Pale Skin'],['ME13','#B53883','深品红 / Deep Magenta'],['ME14','#FFDDC7','浅杏粉 / Light Apricot Pink'],['ME15','#E5C6D0','浅粉肤 / Light Pink Skin'],
  ['ME16','#F9F2EB','淡米白 / Pale Cream'],['ME17','#E7DCE6','淡粉白 / Pale Pink-White'],['ME18','#FFD3E6','浅粉白 / Light Pink-White'],['ME19','#FFD5EC','淡粉 / Pale Pink'],
  ['ME20','#F3DCE8','灰粉 / Gray Pink'],['ME21','#BD9CA3','棕粉 / Brown Pink'],['ME22','#C578A5','灰棕粉 / Gray Brown Pink'],['ME23','#A37A9B','深灰粉 / Deep Gray Pink'],
  ['ME24','#F4E8FF','浅紫粉 / Light Purple Pink'],['MF1','#FF7F67','浅红 / Light Red'],['MF2','#FF5D46','深红 / Deep Red'],['MF3','#E3564A','砖红 / Brick Red'],
  ['MF4','#C7270D','亮红 / Bright Red'],['MF5','#BE0A27','正红 / True Red'],['MF6','#83411E','深棕红 / Deep Brown Red'],['MF7','#730037','暗棕红 / Dark Brown Red'],
  ['MF8','#AB0022','深红 / Dark Red'],['MF9','#DE7995','浅红 / Light Red'],['MF10','#AB613C','棕红 / Brown Red'],['MF11','#5C2929','深棕 / Deep Brown'],
  ['MF12','#F34461','玫瑰红 / Rose Red'],['MF13','#C64239','番茄红 / Tomato Red'],['MF14','#FFA5BB','浅粉红 / Light Pink-Red'],['MF15','#BC0018','深绯红 / Deep Crimson'],
  ['MF16','#FFD7CB','浅肉红 / Light Flesh Red'],['MF17','#F19D8A','浅棕红 / Light Brown Red'],['MF18','#DC7B45','棕红 / Brown Red'],['MF19','#C74651','深棕红 / Deep Brown Red'],
  ['MF20','#D8A89E','灰棕红 / Gray Brown Red'],['MF21','#EB9DB9','浅粉棕 / Light Pink-Brown'],['MF22','#FFD4D4','淡粉棕 / Pale Pink-Brown'],['MF23','#EA8474','珊瑚红 / Coral Red'],
  ['MF24','#F7C1C5','玫瑰红 / Rose Red'],['MF25','#FC5768','砖红 / Brick Red'],['MG1','#FFE7C8','淡肤色 / Pale Skin'],['MG2','#FFD6C3','浅肤色 / Light Skin'],
  ['MG3','#EEB694','肤色 / Skin'],['MG4','#D9A58C','深肤色 / Deep Skin'],['MG5','#F49630','棕金 / Brown Gold'],['MG6','#F19937','深棕金 / Deep Brown Gold'],
  ['MG7','#AC745B','深棕 / Deep Brown'],['MG8','#694A42','深棕色 / Dark Brown'],['MG9','#F7CC9D','浅棕 / Light Brown'],['MG10','#C7832F','棕色 / Brown'],
  ['MG11','#D3C391','浅棕金 / Light Brown Gold'],['MG12','#E6B986','浅橙棕 / Light Orange Brown'],['MG13','#C67B4F','棕红 / Brown Red'],['MG14','#8D6242','深棕 / Deep Brown'],
  ['MG15','#F6F7E2','淡米黄 / Pale Cream Yellow'],['MG16','#F2E7D7','浅米肤 / Light Cream Skin'],['MG17','#786562','深棕灰 / Deep Brown Gray'],['MG18','#FEF5EB','浅肤米 / Light Skin Cream'],
  ['MG19','#F0AB47','橙棕 / Orange Brown'],['MG20','#AE6949','深橙棕 / Deep Orange Brown'],['MG21','#BF8C6E','棕灰 / Brown Gray'],['MH1','#FFFFFF','透明 / Transparent'],
  ['MH2','#FFFFFF','极白 / Pure White'],['MH3','#9B9B9B','浅灰 / Light Gray'],['MH4','#6D6D6D','中灰 / Medium Gray'],['MH5','#4D4D4D','深灰 / Deep Gray'],
  ['MH6','#3A3A3A','深深灰 / Very Dark Gray'],['MH7','#000000','黑色 / Black'],['MH8','#FFF0F1','淡棕灰 / Pale Brown Gray'],['MH9','#E3E6DF','淡灰紫 / Pale Gray Purple'],
  ['MH10','#E2E0E7','浅灰 / Light Gray'],['MH11','#BCB8B5','灰色 / Gray'],['MH12','#F7F3E1','淡米白 / Pale Cream White'],['MH13','#EADDC8','淡紫灰 / Pale Purple Gray'],
  ['MH14','#B8C8C5','灰绿 / Gray Green'],['MH15','#99ABAC','淡灰绿 / Pale Gray Green'],['MH16','#444236','深灰 / Dark Gray'],['MH17','#FAFBF5','淡灰 / Pale Gray'],
  ['MH18','#FEFEEE','淡白 / Pale White'],['MH19','#FBF2E4','淡米灰 / Pale Cream Gray'],['MH20','#9EAEAD','中灰 / Medium Gray'],['MH21','#FDFFF2','淡黄白 / Pale Yellow White'],
  ['MH22','#EDEDE7','浅灰 / Light Gray'],['MH23','#B4B8A7','灰绿 / Gray Green'],['MM1','#AEBBA8','灰绿 / Gray Green'],['MM2','#729376','深灰绿 / Deep Gray Green'],
  ['MM3','#6A8890','蓝灰绿 / Blue Gray Green'],['MM4','#BEB39D','淡棕灰 / Pale Brown Gray'],['MM5','#B8B78C','灰棕 / Gray Brown'],['MM6','#B2AC93','深灰棕 / Deep Gray Brown'],
  ['MM7','#BC9F94','灰棕 / Gray Brown'],['MM8','#968381','棕灰 / Brown Gray'],['MM9','#B39D88','深棕 / Deep Brown'],['MM10','#B796A3','紫灰 / Purple Gray'],
  ['MM11','#B096B9','深紫灰 / Deep Purple Gray'],['MM12','#685951','深棕灰 / Deep Brown Gray'],['MM13','#C79582','棕色 / Brown'],['MM14','#CA694F','深棕 / Deep Brown'],
  ['MM15','#929FA9','深灰 / Deep Gray'],
];

/** 把 [code, hex] 或 [code, hex, name] 行转成色号对象 */
function toBeads(rows, brandKey) {
  return rows.map(([code, hex, name]) => ({
    code, hex, name: name || code, brand: brandKey, group: codeGroup(code),
  }));
}

/** 取色号的字母前缀作为分组，如 "MA12" → "MA"，"S3" → "S" */
function codeGroup(code) {
  const m = /^([A-Za-z]+)/.exec(code);
  return m ? m[1].toUpperCase() : '#';
}

const PALETTES = {
  'mard': {
    label: 'MARD 漫漫 221',
    short: '漫漫',
    note: '国内图纸最常见的参考色卡',
    beads: toBeads(MARD_BEADS, 'mard'),
  },
  'coco': {
    label: 'COCO 可可 291',
    short: 'COCO',
    note: '与 MARD 291 同一套色，编号不同',
    beads: toBeads(COCO_BEADS, 'coco'),
  },
  'perler': {
    label: 'Perler 帕勒',
    short: 'Perler',
    note: '美国品牌，色号用官方 SKU',
    beads: toBeads(PERLER_BEADS, 'perler'),
  },
  'hama': {
    label: 'Hama 哈马',
    short: 'Hama',
    note: '丹麦品牌，89 色经典盘',
    beads: toBeads(HAMA_BEADS, 'hama'),
  },
  'artkal': {
    label: 'Artkal 5mm',
    short: 'Artkal',
    note: '色域最广，含 SE 扩展系',
    beads: toBeads(ARTKAL_BEADS, 'artkal'),
  },
  'artkal-mini': {
    label: 'Artkal 2.6mm 迷你',
    short: 'Artkal迷',
    note: '小号豆，尺寸不同不可混用',
    beads: toBeads(ARTKAL_MINI_BEADS, 'artkal-mini'),
  },
  gray: {
    label: '灰度 32 阶',
    short: '灰度',
    note: '工具板：压色或做素描稿',
    beads: Array.from({ length: 32 }, (_, i) => {
      const v = Math.round((i / 31) * 255);
      const h = v.toString(16).padStart(2, '0').toUpperCase();
      const code = 'G' + String(i).padStart(2, '0');
      return { code, hex: '#' + h + h + h, name: code, brand: 'gray', group: 'G' };
    }),
  },
};

/** 拼豆常见规格（边长毫米） */
const BEAD_MM = 5;
const BOARD_SIZES = { 29: '29×29 小板', 57: '57×57 大板' };

if (typeof window !== 'undefined') {
  window.PALETTES = PALETTES;
  window.GROUP_LABELS = GROUP_LABELS;
  window.BEAD_MM = BEAD_MM;
  window.BOARD_SIZES = BOARD_SIZES;
  window.codeGroup = codeGroup;
}
