import { COMPANY_URL_SHAPE, OPPORTUNITY_URL_SHAPE } from '../crm-link.js';
import type { Annotation, Ask, Deny } from '../rules/types.js';
import { assertNever, joinList, truncate, type DenyText, type Templates } from './templates.js';

const kindNames = { demo: 'Démonstration produit', technical_discovery: 'Découverte technique', poc: 'PoC', rfx: 'Réponse RFx' } as const;
const qualification = {
  volume: ['Volume (nombre de certificats gérés par le CLM)', "ajoutez-le dans une note Twenty sur l'opportunité"], hosting: ['Hébergement', "renseignez le champ Hosting de l'opportunité dans Twenty"],
  solution: ['Solution souhaitée', 'renseignez le champ Besoin ou ajoutez une note Twenty'], decisionMaker: ['Décisionnaire', "renseignez le champ Décisionnaires de l'opportunité dans Twenty"],
  budget: ['Budget', 'ajoutez-le dans une note Twenty'], timeline: ['Calendrier du projet', 'ajoutez-le dans une note Twenty'],
  currentPki: ['PKI actuelle', 'renseignez le champ Technical information ou ajoutez une note Twenty'], useCases: ["Cas d'usage", 'renseignez le champ Besoin ou ajoutez une note Twenty'],
  clmDriver: ['Motivation CLM (pourquoi un CLM maintenant)', 'ajoutez-le dans une note Twenty'],
} as const;

function itemLine(item: Extract<Deny, { key: 'qualification.missing' }>['items'][number]): string {
  const [label, fix] = qualification[item.id];
  return item.status === 'declared_unobtainable' ? `${label} : information déclarée impossible à obtenir, ${fix}` : `${label} : information manquante, ${fix}`;
}

function deny(denyValue: Deny): DenyText {
  switch (denyValue.key) {
    case 'single_request.multiple': return { policy: 'une demande par ticket. Merci de créer une demande séparée pour chaque demande supplémentaire ci-dessous.', items: denyValue.items.map((item) => `${kindNames[item.kind]} supplémentaire : « ${item.quote} »`) };
    case 'crm_link.invalid': return { policy: 'chaque demande doit contenir le lien vers son opportunité Twenty.', items: [denyValue.raw === '' ? "Aucun lien n'est fourni." : `Le lien fourni (« ${truncate(denyValue.raw)} ») n'est pas un lien d'opportunité Twenty.`, `Modifiez la description du ticket et collez l'URL de l'opportunité sous cette forme : ${OPPORTUNITY_URL_SHAPE}`, ...(denyValue.partnerOnly ? [`Pour une demande partenaire seul, un lien de société est aussi accepté : ${COMPANY_URL_SHAPE}`] : [])] };
    case 'crm_link.not_found': return { policy: 'chaque demande doit pointer vers un enregistrement Twenty existant.', items: [`Aucune ${denyValue.recordKind === 'opportunity' ? 'opportunité' : 'société'} Twenty avec l'identifiant ${denyValue.id} n'existe. Vérifiez le lien dans la description du ticket.`] };
    case 'rfx_deal.not_rfx': return { policy: "un ticket RFx doit avoir une opportunité Twenty pour ce RFI, RFQ ou RFP.", items: ["L'opportunité liée n'a pas le type de négociation RFX. Créez l'opportunité du RFx dans Twenty, ou passez son type de négociation à RFX, puis liez-la dans la description du ticket."] };
    case 'notes_exist.none': return { policy: "l'opportunité doit avoir au moins une note de qualification.", items: [`Twenty ne contient aucune note sur l'opportunité ni aucune note sur sa société datant des ${denyValue.maxAgeMonths} derniers mois. Ajoutez une note sur l'opportunité dans Twenty.`] };
    case 'qualification.missing': return { policy: `une opportunité new business doit avoir un volume et un décisionnaire connus, et au plus ${denyValue.maxUnknown} autres éléments de qualification inconnus.`, items: [...denyValue.items.map(itemLine), ...(denyValue.dataQualityMissing === '' ? [] : [`Contrôle qualité Twenty : ${denyValue.dataQualityMissing}. Complétez ces champs dans Twenty.`])] };
    case 'volume_floor.below_min': return { policy: `les affaires new business de moins de ${denyValue.min} certificats sont traitées par les partenaires.`, items: [`Le volume indiqué est de ${denyValue.max} certificats. S'il est faux, corrigez-le dans une note Twenty sur l'opportunité.`] };
    case 'discovery_first.missing': return { policy: `les demandes de type ${kindNames[denyValue.kind]} pour une affaire new business nécessitent d'abord une découverte technique.`, items: [`Aucune découverte technique terminée pour ce client dans les ${denyValue.maxAgeMonths} derniers mois, et aucune note Twenty n'en mentionne. Si elle a eu lieu, ajoutez une note Twenty qui l'indique.`, ...(denyValue.kind === 'demo' ? ['Merci de créer plutôt une demande de découverte technique.'] : [])] };
    case 'slot.rep_declined_move': return { policy: 'une réunion nécessite un ingénieur avant-vente disponible.', items: ["Personne n'est disponible sur le créneau demandé et la date ne peut pas être déplacée."] };
    case 'slot.no_slot': return { policy: 'une demande de réunion doit indiquer une date et un horaire.', items: ["Le ticket ne donne aucun créneau et n'indique pas que des créneaux ont été proposés au client. Répondez dans ce fil avec la date, l'heure de début et l'heure de fin."] };
    case 'poc_volume.below_min': return { policy: `un PoC nécessite un volume d'au moins ${denyValue.min} certificats.`, items: [`Le volume indiqué est de ${denyValue.max} certificats. S'il est faux, corrigez-le dans une note Twenty sur l'opportunité.`] };
    case 'poc_paid.no_quote': return { policy: "les PoC sont payants sauf accord d'un approbateur.", items: ["Aucun devis Twenty avec une ligne PoC n'est lié à l'opportunité. Liez le devis du PoC à l'opportunité dans Twenty.", "Si un approbateur a accepté un PoC gratuit, ajoutez une note Twenty qui cite l'accord et nomme l'approbateur."] };
    case 'wait.no_answer': return { policy: "les questions doivent recevoir une réponse dans le délai d'attente.", items: ["Aucune réponse du demandeur n'a été reçue."] };
    default: return assertNever(denyValue);
  }
}

function ask(askValue: Ask): string {
  switch (askValue.key) {
    case 'volume_floor.unclear': return `Combien de certificats le CLM gérera-t-il ? Le ticket indique « ${askValue.quote} », ce qui ne donne pas le nombre de certificats gérés par le CLM.`;
    case 'slot.incomplete': {
      const names = { date: 'la date', start: "l'heure de début", end: "l'heure de fin" } as const;
      return askValue.missing.length === 0 ? "Le créneau de la réunion n'est pas clair. Merci d'indiquer la date exacte, l'heure de début et l'heure de fin." : `Merci d'indiquer ${joinList(askValue.missing.map((part) => names[part]), ' et ')} de la réunion.`;
    }
    case 'slot.past': return `Le créneau de la réunion (${askValue.date} ${askValue.start}) est passé. Merci d'indiquer une date et une heure futures.`;
    case 'slot.nobody_available': return `Personne dans l'équipe avant-vente n'est disponible le ${askValue.date} de ${askValue.start} à ${askValue.end} (${askValue.timezone}). La date peut-elle être déplacée ?`;
    default: return assertNever(askValue);
  }
}

function annotation(annotationValue: Annotation): string {
  switch (annotationValue.key) {
    case 'slot.timezone_assumed': return `Aucun fuseau horaire n'est indiqué ; les horaires sont lus en ${annotationValue.timezone}.`;
    case 'slot.short_notice': return `Délai court : moins de ${annotationValue.workingDays} jours ouvrés pleins avant la réunion. Merci de confirmer que le créneau ne peut pas être déplacé.`;
    case 'slot.onsite': return "Réunion sur site : les déplacements n'ont pas été vérifiés. Le responsable du triage choisit l'ingénieur avant-vente.";
    case 'slot.free_members': return `Disponibles sur le créneau : ${annotationValue.members.join(', ')}.`;
    case 'slot.check_later': return 'Des créneaux ont été proposés au client. Les disponibilités seront vérifiées une fois la date connue.';
    case 'owner.active': {
      if (annotationValue.freeOnSlot === true) return `Ce client est suivi par ${annotationValue.owner} (voir ${annotationValue.ticket}), merci d'assigner en conséquence. ${annotationValue.owner} est disponible sur le créneau.`;
      if (annotationValue.freeOnSlot === false) return `Ce client est suivi par ${annotationValue.owner} (voir ${annotationValue.ticket}), merci d'assigner en conséquence. ${annotationValue.owner} n'est pas disponible sur le créneau.`;
      return `Ce client est suivi par ${annotationValue.owner} (voir ${annotationValue.ticket}), merci d'assigner en conséquence.`;
    }
    case 'owner.away': return `${annotationValue.owner} a suivi ce client (voir ${annotationValue.ticket}) et est actuellement absent ; le responsable du triage décide.`;
    case 'partner.caution': return `Aucun partenaire n'est enregistré pour cette affaire dans Twenty, dans les notes ou dans la demande.${annotationValue.indirect ? " L'affaire est indiquée comme indirecte, mais aucun partenaire n'est nommé." : ''}`;
    case 'poc.go_nogo': return "Ce ticket n'a pas été disqualifié ; vous pouvez lancer l'étape Go/NoGo du PoC.";
    case 'poc_paid.exception': return `PoC gratuit accordé par ${annotationValue.approver} : « ${annotationValue.quote} »`;
    default: return assertNever(annotationValue);
  }
}

export const FR: Templates = {
  header: (verdict) => ({ denied: '**Triage avant-vente : demande non acceptée**', waiting: '**Triage avant-vente : informations nécessaires**', accepted: '**Triage avant-vente : demande acceptée**' })[verdict],
  acceptedBody: 'Cette demande respecte la politique de triage avant-vente.', notesHeading: 'Remarques :', policyPrefix: 'Politique de triage avant-vente : ',
  recheckLine: 'Une fois corrigé, répondez `recheck` dans ce fil pour relancer la vérification.', waitingFooter: 'Répondez dans ce fil. La demande est vérifiée à nouveau après chaque réponse.', deny, ask, annotation,
};
