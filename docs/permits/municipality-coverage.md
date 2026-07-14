# Permit research coverage

Agir includes all 21 Metro Vancouver municipalities plus the City of Kelowna.
On 2026-07-14 the official permit/planning source inventory was completed for
all 22 jurisdictions. This is research evidence, not municipal, legal, or
professional approval and not a project-specific permit determination.

## Coverage states

- `not_started`: no official source check has been recorded.
- `partial`: some official sources were checked and the source inventory is
  incomplete.
- `researched`: the jurisdiction's official permit/planning source inventory
  was checked, with the check date, recheck date, scope, and limitations stored
  in `municipal_research_sources`. Category and case applicability can remain
  unknown.
- `reviewed`: every supported category has a current record from an assigned
  qualified reviewer. A migration never promotes research to this state.

## Completed source inventory

| Jurisdiction | Official source checked |
|---|---|
| Anmore | [Building and development](https://anmore.com/building-development/) |
| Belcarra | [Building Department](https://belcarra.ca/services/building-department/) |
| Bowen Island | [Online planning applications](https://bowenislandmunicipality.ca/online-planning-applications/) |
| Burnaby | [Permits and construction](https://www.burnaby.ca/services-and-payments/permits-and-construction) |
| Coquitlam | [Planning and development resources](https://www.coquitlam.ca/225/Planning-and-Development-Resources) |
| Delta | [Permits and licences](https://www.delta.ca/services/permits-licences) |
| City of Langley | [Applications, forms and permits](https://www.langleycity.ca/city-services/applications-forms-permits) |
| Township of Langley | [Building and development](https://www.tol.ca/en/building-development/building.aspx) |
| Lions Bay | [Forms and applications](https://www.lionsbay.ca/services/administration/forms-applications) |
| Maple Ridge | [Construction, development and permits](https://www.mapleridge.ca/build-do-business/construction-development-permits) |
| New Westminster | [Making a development application](https://www.newwestcity.ca/development-policies-and-process/making-a-development-application) |
| City of North Vancouver | [Active applications](https://www.cnv.org/Business-Development/Building/Land-Use-Approvals/Active-Applications) |
| District of North Vancouver | [Development permit procedure](https://docs.dnv.org/documents/Development_Permit_Application_Procedure.pdf) |
| Pitt Meadows | [Planning and Development Services](https://www.pittmeadows.ca/city-hall/city-departments/planning-and-development-services) |
| Port Coquitlam | [Property development and building](https://www.portcoquitlam.ca/business-development/property-development-building) |
| Port Moody | [Development application process](https://www.portmoody.ca/business-development-and-planning/development/development-application-process/) |
| Richmond | [Planning and Development](https://richmond.ca/city-hall/city-departments/planning-development.htm) |
| Surrey | [Renovating, building and development](https://www.surrey.ca/renovating-building-development) |
| Vancouver | [Forms and checklists](https://vancouver.ca/home-property-development/application-forms-and-checklists.aspx) |
| West Vancouver | [Building permits and inspections](https://westvancouver.ca/business-development/building-development/building-permits-inspections) |
| White Rock | [Building permits](https://www.whiterockcity.ca/941/Building-Permits) |
| Kelowna | [Building permits and inspections](https://www.kelowna.ca/homes-building/building-permits-inspections) |

## Decision gate

Before Agir labels a permit required or not applicable, the category record must
include the supporting official text, applicability and exemption limits,
source owner, check and next-check dates, and a named qualified decision maker.
Unavailable, contradictory, stale, or incomplete evidence remains visible and
fails closed.
