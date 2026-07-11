-- Complete 6 municipality x 14 category pilot matrix. Missing official answers
-- remain explicit unknowns; catalogue rows are never automatic requirements.
WITH categories(permit_type, label) AS (VALUES
 ('building','Building permit'),('development','Development permit'),('zoning_land_use','Zoning or land-use approval'),
 ('plumbing','Plumbing permit'),('electrical','Electrical permit'),('mechanical_hvac','Mechanical or HVAC permit'),
 ('demolition','Demolition permit'),('tenant_improvement','Tenant improvement permit'),('occupancy_change_of_use','Occupancy or change-of-use approval'),
 ('fire_life_safety','Fire or life-safety approval'),('tree','Tree permit'),('heritage','Heritage approval'),
 ('environmental_site','Environmental or site-related approval'),('excavation_shoring_servicing','Excavation, shoring, or servicing approval')
)
INSERT INTO public.permit_rules(jurisdiction_id,name,permit_type,description,applicability_conditions,official_source_url,source_title,source_text,application_url,review_date,rule_version,verification_status)
SELECT j.id,c.label,c.permit_type,
 'Pilot catalogue category. No project-specific determination has been made.',
 'Cannot be determined from municipality, address, or project type alone. Confirm scope and current requirements with the issuing authority.',
 j.permit_portal_url, j.name || ' permit information',
 'No category-specific official determination is recorded in the reviewed pilot source set.',
 j.permit_portal_url,'2026-07-10','2026-07-10-matrix','unknown'
FROM public.jurisdictions j CROSS JOIN categories c
WHERE j.name IN ('City of Vancouver','City of Burnaby','City of Richmond','City of Surrey','City of New Westminster','City of Kelowna')
ON CONFLICT(jurisdiction_id,name,rule_version) DO NOTHING;

-- Category-specific evidence reviewed from official municipal pages.
UPDATE public.permit_rules r SET verification_status='potentially_applicable', source_title=v.title,
 official_source_url=v.url, application_url=v.url, source_text=v.source_text,
 applicability_conditions=v.conditions
FROM public.jurisdictions j JOIN (VALUES
 ('City of Vancouver','building','Building and renovating','https://vancouver.ca/home-property-development/building-and-renovating.aspx','The City publishes building and renovation permit guidance.','Applicability depends on the verified work scope.'),
 ('City of Vancouver','development','Get a development permit','https://vancouver.ca/home-property-development/development-permit.aspx','The City states a separate development permit can depend on zoning and proposal details.','Potentially applicable; requires verified site and proposal facts.'),
 ('City of Vancouver','zoning_land_use','Get a development permit','https://vancouver.ca/home-property-development/development-permit.aspx','The City directs applicants to zoning rules when assessing development permits.','Needs authoritative zoning and proposal review.'),
 ('City of Vancouver','plumbing','Building and renovating','https://vancouver.ca/home-property-development/building-and-renovating.aspx','The City publishes plumbing permit and inspection services.','Potentially applicable only to verified plumbing work.'),
 ('City of Vancouver','electrical','Building and renovating','https://vancouver.ca/home-property-development/building-and-renovating.aspx','The City publishes electrical permit and inspection services.','Potentially applicable only to verified electrical work.'),
 ('City of Vancouver','demolition','Apply for and manage your permit','https://vancouver.ca/home-property-development/apply-for-and-manage-your-permit.aspx','The City publishes demolition permit guidance.','Potentially applicable only to verified demolition work.'),
 ('City of Vancouver','tree','Apply for and manage your permit','https://vancouver.ca/home-property-development/apply-for-and-manage-your-permit.aspx','The City publishes a tree removal permit category.','Potentially applicable only where regulated tree work is verified.'),
 ('City of Burnaby','building','Home Improvement Permits','https://www.burnaby.ca/services-and-payments/development-permits-construction/home-improvement-permits','The City publishes building permit guidance for construction and alteration.','Applicability depends on verified work scope.'),
 ('City of Burnaby','development','Home Improvement Permits','https://www.burnaby.ca/services-and-payments/development-permits-construction/home-improvement-permits','The City notes some projects require a development permit before a building permit.','Potentially applicable; project review required.'),
 ('City of Burnaby','demolition','Home Improvement Permits','https://www.burnaby.ca/services-and-payments/development-permits-construction/home-improvement-permits','The City includes demolition in work requiring a permit.','Potentially applicable only to verified demolition work.'),
 ('City of Burnaby','tenant_improvement','Home Improvement Permits','https://www.burnaby.ca/services-and-payments/development-permits-construction/home-improvement-permits','The City identifies commercial tenant improvement permit applications.','Potentially applicable only to verified tenant improvement work.'),
 ('City of Richmond','building','Building Approvals FAQs','https://www.richmond.ca/business-development/building-approvals/faqs.htm','The City lists building permits and work for which permits are required.','Applicability depends on verified work scope.'),
 ('City of Richmond','plumbing','Building Approvals FAQs','https://www.richmond.ca/business-development/building-approvals/faqs.htm','The City lists plumbing permits and plumbing trades work.','Potentially applicable only to verified plumbing work.'),
 ('City of Richmond','demolition','Demolition, Moving or Salvage Program','https://www.richmond.ca/business-development/building-approvals/demomoveandsalvage.htm','The City publishes demolition application requirements.','Potentially applicable only to verified demolition work.'),
 ('City of Richmond','tree','Building Approvals FAQs','https://www.richmond.ca/business-development/building-approvals/faqs.htm','The City lists tree permits.','Potentially applicable only where regulated tree work is verified.'),
 ('City of Richmond','fire_life_safety','Building Approvals','https://www.richmond.ca/business-development/building-approvals.htm','The City publishes sprinkler permit services and fire/life-safety review context.','Specific approval depends on verified systems and scope.'),
 ('City of Richmond','excavation_shoring_servicing','Building Approvals FAQs','https://www.richmond.ca/business-development/building-approvals/faqs.htm','The City lists site service permits.','Specific servicing approval depends on verified work.'),
 ('City of Surrey','building','Commercial Building Permits','https://www.surrey.ca/renovating-building-development/building/commercial-building-permits','The City publishes commercial, industrial, institutional and multifamily building permit guidance.','Applicability depends on verified work scope.'),
 ('City of Surrey','plumbing','Permitting Portal Guide','https://www.surrey.ca/renovating-building-development/permitting-portal-guide','The City provides plumbing permit online services.','Potentially applicable only to verified plumbing work.'),
 ('City of Surrey','electrical','Permitting Portal Guide','https://www.surrey.ca/renovating-building-development/permitting-portal-guide','The City provides electrical permit online services.','Potentially applicable only to verified electrical work.'),
 ('City of Surrey','tenant_improvement','Tenant and Landlord Improvement Building Permit','https://www.surrey.ca/renovating-building-development/building/commercial-building-permits/tenant-and-landlord-improvement-building-permit','The City publishes tenant and landlord improvement permit scope and exclusions.','Potentially applicable; actual alterations must be verified.'),
 ('City of Surrey','environmental_site','Submitting a Development Application','https://www.surrey.ca/renovating-building-development/land-planning-development/land-development-application-process/submitting-a-development-application','The City describes watercourse assessment and possible Sensitive Ecosystem Development Permit review.','Potentially applicable only with verified site conditions.'),
 ('City of New Westminster','building','Forms and Documentation','https://www.newwestcity.ca/forms-and-documentation','The City states building permits cover construction, alteration, or demolition.','Applicability depends on verified work scope.'),
 ('City of New Westminster','plumbing','Forms and Documentation','https://www.newwestcity.ca/forms-and-documentation','The City publishes plumbing permit guides and application forms.','Potentially applicable only to verified plumbing work.'),
 ('City of New Westminster','demolition','Demolition Permit Application Package','https://www.newwestcity.ca/database/files/library/Demolition_Permit_Application_Package_June_2025.pdf','The City publishes a demolition permit application package.','Potentially applicable only to verified demolition work.'),
 ('City of New Westminster','occupancy_change_of_use','Forms and Documentation','https://www.newwestcity.ca/forms-and-documentation','The City publishes occupancy certificate documentation for multifamily projects.','Specific approval depends on verified building and use facts.'),
 ('City of Kelowna','building','Apply for a building permit','https://www.kelowna.ca/homes-building/building-permits-inspections/apply-building-permit','The City publishes building application streams for residential, commercial, industrial and multifamily work.','Applicability depends on verified work scope.'),
 ('City of Kelowna','development','Apply for a Development Application','https://www.kelowna.ca/homes-building/planning-development/apply-development-application','The City publishes multiple development application types.','Specific approval depends on verified site and proposal facts.'),
 ('City of Kelowna','zoning_land_use','Apply for a Development Application','https://www.kelowna.ca/homes-building/planning-development/apply-development-application','The City publishes rezoning and OCP amendment application information.','Needs authoritative zoning and proposal review.'),
 ('City of Kelowna','demolition','Apply for a building permit','https://www.kelowna.ca/homes-building/building-permits-inspections/apply-building-permit','The City provides a building demolition and decommission application stream.','Potentially applicable only to verified demolition work.'),
 ('City of Kelowna','tenant_improvement','Tenant Improvement Bulletin','https://www.kelowna.ca/sites/files/1/docs/homes-building/tenant_improvement_-_bulletin_0.pdf','The City defines tenant improvement work and publishes application requirements.','Potentially applicable only to verified tenant improvement work.'),
 ('City of Kelowna','heritage','Apply for a Development Application','https://www.kelowna.ca/homes-building/planning-development/apply-development-application','The City lists heritage development proposals and alteration permits.','Potentially applicable only with verified heritage status and work.'),
 ('City of Kelowna','environmental_site','Apply for a Development Application','https://www.kelowna.ca/homes-building/planning-development/apply-development-application','The City lists natural-environment and hazardous-condition development proposals.','Potentially applicable only with verified site conditions.'),
 ('City of Kelowna','tree','Apply for a Development Application','https://www.kelowna.ca/homes-building/planning-development/apply-development-application','The City publishes tree removal information for environmentally sensitive areas.','Potentially applicable only with verified site and tree facts.'),
 ('City of Kelowna','excavation_shoring_servicing','Apply for a Development Application','https://www.kelowna.ca/homes-building/planning-development/apply-development-application','The City lists soil deposit and removal applications.','Specific approval depends on verified earthwork and site facts.')
) AS v(city,ptype,title,url,source_text,conditions) ON j.name=v.city
WHERE r.jurisdiction_id=j.id AND r.permit_type=v.ptype AND r.rule_version='2026-07-10-matrix';

-- A linked/source document must belong to the same project as the permit.
CREATE OR REPLACE FUNCTION public.validate_permit_document_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE permit_project uuid; linked_project uuid; source_id uuid;
BEGIN
 IF TG_TABLE_NAME='permit_documents' THEN
   SELECT project_id INTO permit_project FROM public.project_permits WHERE id=NEW.permit_id;
   source_id := NEW.document_id;
 ELSIF TG_TABLE_NAME='permit_requirements' THEN
   SELECT project_id INTO permit_project FROM public.project_permits WHERE id=NEW.project_permit_id;
   IF NEW.document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id=NEW.document_id AND d.project_id=permit_project) THEN
     RAISE EXCEPTION 'Permit documents must belong to the same project' USING ERRCODE='23514';
   END IF;
   source_id := NEW.source_document_id;
 ELSE
   permit_project := NEW.project_id;
   source_id := NEW.source_document_id;
 END IF;
 IF source_id IS NOT NULL THEN
   SELECT project_id INTO linked_project FROM public.documents WHERE id=source_id;
   IF linked_project IS DISTINCT FROM permit_project THEN
     RAISE EXCEPTION 'Permit documents must belong to the same project' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_permit_document_scope BEFORE INSERT OR UPDATE ON public.project_permits FOR EACH ROW EXECUTE FUNCTION public.validate_permit_document_scope();
CREATE TRIGGER permit_requirement_document_scope BEFORE INSERT OR UPDATE ON public.permit_requirements FOR EACH ROW EXECUTE FUNCTION public.validate_permit_document_scope();
CREATE TRIGGER permit_document_scope BEFORE INSERT OR UPDATE ON public.permit_documents FOR EACH ROW EXECUTE FUNCTION public.validate_permit_document_scope();
