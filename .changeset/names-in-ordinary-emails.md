---
"@centrst/blind": minor
---

`blind` finds more names and companies in ordinary emails with nothing in `known`. Before, a person was found only through `known`, a `Name <address>` sender line, a title such as `Dr.`, or a repeat of a name already found, so `Dear Margaret,` and a signature went out as written with a clean leak check. Now these count too:

- A greeting at the start of a line (`Dear Margaret,`, `Hi Ana, Luis and Marta,`, `Hola Belén:`, `Estimado/a Cayetano,`, `Buenos días Isidro,`) names a person. `Hi all`, `Hi team`, `Dear Sir`, `Dear Customer` and `Hola a todos` name no one.
- The line right after a closing (`Kind regards,`, `Thanks,`, `Un saludo,`, `Atentamente,`) holding only capitalised words is a person, and the first company line below it an org. `Regards,` above `Accounts` or `Sent from my iPhone` names no one.
- A label (`Name:`, `Patient:`, `Customer:`, `Nombre:`, `Paciente:`) before a name is a person, and `Company:` or `Empresa:` before one an org.
- Capitalised words before a legal suffix (`Ltd`, `LLC`, `Inc`, `GmbH`, `PLC`, `Corp`, `S.L.`, `S.A.`) are an org anywhere in the text, so `Moorcroft Joinery Ltd.` in prose is now replaced.
- The words of a private address name its person and company: `margaret.holloway@finchley-dental.example` makes a later `Margaret` a person and `Finchley Dental` an org.

On the test corpus with nothing in `known`, people found went from 67.1% to 85.1% and companies from 29.7% to 98.2%, and precision rose for both. Text that used to pass through unchanged can now have a fake name or company in it, so outputs for the same seed differ from earlier versions.
