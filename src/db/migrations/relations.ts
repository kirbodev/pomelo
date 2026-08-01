import { relations } from "drizzle-orm/relations";
import { calendarUser, calendarAccount, calendarAuthenticator, calendarSession, mod_cases, case_notes, warns } from "./schema";

export const calendarAccountRelations = relations(calendarAccount, ({one}) => ({
	calendarUser: one(calendarUser, {
		fields: [calendarAccount.userId],
		references: [calendarUser.id]
	}),
}));

export const calendarUserRelations = relations(calendarUser, ({many}) => ({
	calendarAccounts: many(calendarAccount),
	calendarAuthenticators: many(calendarAuthenticator),
	calendarSessions: many(calendarSession),
}));

export const calendarAuthenticatorRelations = relations(calendarAuthenticator, ({one}) => ({
	calendarUser: one(calendarUser, {
		fields: [calendarAuthenticator.userId],
		references: [calendarUser.id]
	}),
}));

export const calendarSessionRelations = relations(calendarSession, ({one}) => ({
	calendarUser: one(calendarUser, {
		fields: [calendarSession.userId],
		references: [calendarUser.id]
	}),
}));

export const case_notesRelations = relations(case_notes, ({one}) => ({
	mod_case: one(mod_cases, {
		fields: [case_notes.case_id],
		references: [mod_cases.id]
	}),
}));

export const mod_casesRelations = relations(mod_cases, ({many}) => ({
	case_notes: many(case_notes),
	warns: many(warns),
}));

export const warnsRelations = relations(warns, ({one}) => ({
	mod_case: one(mod_cases, {
		fields: [warns.case_id],
		references: [mod_cases.id]
	}),
}));