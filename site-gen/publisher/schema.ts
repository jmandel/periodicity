import { Database } from 'bun:sqlite';

export function createPackageDbSchema(db: Database) {
  db.exec(`
DROP TABLE IF EXISTS CodeSystemList;
DROP TABLE IF EXISTS CodeSystemListOIDs;
DROP TABLE IF EXISTS CodeSystemListRefs;
DROP TABLE IF EXISTS ConceptMappings;
DROP TABLE IF EXISTS ConceptProperties;
DROP TABLE IF EXISTS Concepts;
DROP TABLE IF EXISTS Designations;
DROP TABLE IF EXISTS Metadata;
DROP TABLE IF EXISTS Properties;
DROP TABLE IF EXISTS Resources;
DROP TABLE IF EXISTS ValueSetList;
DROP TABLE IF EXISTS ValueSetListOIDs;
DROP TABLE IF EXISTS ValueSetListRefs;
DROP TABLE IF EXISTS ValueSetListSources;
DROP TABLE IF EXISTS ValueSetListSystems;
DROP TABLE IF EXISTS ValueSet_Codes;

CREATE TABLE CodeSystemList (
CodeSystemListKey integer NOT NULL,
ViewType          integer NOT NULL,
ResourceKey       integer NULL,
Url               nvarchar NULL,
Version           nvarchar NULL,
Status            nvarchar NULL,
Name              nvarchar NULL,
Title             nvarchar NULL,
Description       nvarchar NULL,
PRIMARY KEY (CodeSystemListKey));

CREATE TABLE CodeSystemListOIDs (
CodeSystemListKey integer NOT NULL,
OID               nvarchar NOT NULL,
PRIMARY KEY (CodeSystemListKey,OID));

CREATE TABLE CodeSystemListRefs (
CodeSystemListKey integer NOT NULL,
Type              nvarchar NOT NULL,
Id                nvarchar NOT NULL,
ResourceKey       integer NULL,
Title             nvarchar NULL,
Web               nvarchar NULL,
PRIMARY KEY (CodeSystemListKey,Type,Id));

CREATE TABLE ConceptMappings (
Key           integer NOT NULL,
ResourceKey   integer NOT NULL,
SourceSystem  varchar NULL,
SourceVersion varchar NULL,
SourceCode    varchar NULL,
Relationship  varchar NULL,
TargetSystem  varchar NULL,
TargetVersion varchar NULL,
TargetCode    varchar NULL,
PRIMARY KEY (Key));

CREATE TABLE ConceptProperties (
Key          integer NOT NULL,
ResourceKey  integer NOT NULL,
ConceptKey   integer NOT NULL,
PropertyKey  integer NULL,
Code         varchar NULL,
Value        varchar NULL,
PRIMARY KEY (Key));

CREATE TABLE Concepts (
Key          integer NOT NULL,
ResourceKey  integer NOT NULL,
ParentKey    integer NULL,
Code         varchar NULL,
Display      varchar NULL,
Definition   varchar NULL,
PRIMARY KEY (Key));

CREATE TABLE Designations (
Key          integer NOT NULL,
ResourceKey  integer NOT NULL,
ConceptKey   integer NOT NULL,
UseSystem    varchar NULL,
UseCode      varchar NULL,
Lang         varchar NULL,
Value        text NULL,
PRIMARY KEY (Key));

CREATE TABLE Metadata (
Key    integer NOT NULL,
Name   nvarchar NOT NULL,
Value  nvarchar NOT NULL,
PRIMARY KEY (Key));

CREATE TABLE Properties (
Key          integer NOT NULL,
ResourceKey  integer NOT NULL,
Code         varchar NOT NULL,
Uri          varchar NULL,
Description  varchar NULL,
Type         varchar NULL,
PRIMARY KEY (Key));

CREATE TABLE Resources (
Key             integer NOT NULL,
Type            nvarchar NOT NULL,
Custom          integer NOT NULL,
Id              nvarchar NOT NULL,
Web             nvarchar NOT NULL,
Url             nvarchar NULL,
Version         nvarchar NULL,
Status          nvarchar NULL,
Date            nvarchar NULL,
Name            nvarchar NULL,
Title           nvarchar NULL,
Experimental    nvarchar NULL,
Realm           nvarchar NULL,
Description     nvarchar NULL,
Purpose         nvarchar NULL,
Copyright       nvarchar NULL,
CopyrightLabel  nvarchar NULL,
derivation      nvarchar NULL,
standardStatus  nvarchar NULL,
kind            nvarchar NULL,
sdType          nvarchar NULL,
base            nvarchar NULL,
content         nvarchar NULL,
supplements     nvarchar NULL,
Json            nvarchar NOT NULL,
PRIMARY KEY (Key));

CREATE TABLE ValueSetList (
ValueSetListKey   integer NOT NULL,
ViewType          integer NOT NULL,
ResourceKey       integer NULL,
Url               nvarchar NULL,
Version           nvarchar NULL,
Status            nvarchar NULL,
Name              nvarchar NULL,
Title             nvarchar NULL,
Description       nvarchar NULL,
PRIMARY KEY (ValueSetListKey));

CREATE TABLE ValueSetListOIDs (
ValueSetListKey   integer NOT NULL,
OID               nvarchar NOT NULL,
PRIMARY KEY (ValueSetListKey,OID));

CREATE TABLE ValueSetListRefs (
ValueSetListKey   integer NOT NULL,
Type              nvarchar NOT NULL,
Id                nvarchar NOT NULL,
ResourceKey       integer NULL,
Title             nvarchar NULL,
Web               nvarchar NULL,
PRIMARY KEY (ValueSetListKey,Type,Id));

CREATE TABLE ValueSetListSources (
ValueSetListKey   integer NOT NULL,
Source            nvarchar NOT NULL,
PRIMARY KEY (ValueSetListKey,Source));

CREATE TABLE ValueSetListSystems (
ValueSetListKey   integer NOT NULL,
URL               nvarchar NOT NULL,
PRIMARY KEY (ValueSetListKey,URL));

CREATE TABLE ValueSet_Codes (
Key             integer NOT NULL,
ResourceKey     integer NOT NULL,
ValueSetUri     nvarchar NOT NULL,
ValueSetVersion nvarchar NOT NULL,
System          nvarchar NOT NULL,
Version         nvarchar NULL,
Code            nvarchar NOT NULL,
Display         nvarchar NULL,
PRIMARY KEY (Key));
`);
}
