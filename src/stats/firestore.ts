import { Firestore } from "@google-cloud/firestore";

// En Cloud Run se autentica solo vía Application Default Credentials (la
// cuenta de servicio adjunta al propio servicio), sin ningún secreto nuevo
// que gestionar. En local hace falta `gcloud auth application-default login`.
// ignoreUndefinedProperties: los jobs de research tienen varios campos
// opcionales (dateFilter, tennisCategory, competitions, reportText...) que
// legítimamente pueden ser `undefined` — sin esto, el cliente de Firestore
// lanza un error al intentar guardarlos en vez de omitirlos sin más.
export const firestore = new Firestore({ ignoreUndefinedProperties: true });
